import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, Repository } from "typeorm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UserRole } from "#/common/entities/user-role.entity";
import { Company } from "#/common/entities/company.entity";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import { TeamRoleType } from "#/common/types/team-role.type";
import {
    ForbiddenAppException,
    InsufficientPermissionsException,
    InternalErrorException,
    ResourceConflictException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { SUPABASE_CLIENT } from "#/common/constants/supabase.constant";
import {
    generateInviteToken,
    getInviteTokenExpiry,
    hashInviteToken,
    verifyInviteToken
} from "#/common/utils/invite-token.util";
import { UsageService } from "#/modules/usage/usage.service";
import { UsersService } from "#/modules/users/users.service";
import { MailService } from "#/modules/mail/mail.service";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ChangeRoleDto } from "./dto/change-role.dto";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import {
    ListTeamMembersQueryDto,
    TeamSortKey
} from "./dto/list-team-members.query.dto";

import { TripStop } from "#/common/entities/trip-stop.entity";
import { StopStatus } from "#/common/constants/stop-status.constant";
import { NotificationSetting } from "#/common/entities/notification-setting.entity";
import { StorageService } from "#/common/storage/storage.service";
import { StoragePath } from "#/common/storage/storage-path.util";

const MANAGER_ROLES = new Set<TeamRoleType>([
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN
]);

const ROLE_LABELS: Record<TeamRoleType, string> = {
    [TeamRoleType.OWNER]: "Owner",
    [TeamRoleType.ADMIN]: "Admin",
    [TeamRoleType.DISPATCHER]: "Dispatcher",
    [TeamRoleType.DRIVER]: "Driver"
};

@Injectable()
export class TeamService {
    private readonly logger: Logger = new Logger(TeamService.name);
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        private readonly usageService: UsageService,
        private readonly usersService: UsersService,
        private readonly mailService: MailService,
        private readonly storageService: StorageService,
        private readonly config: ConfigService,
        @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>,
        @InjectRepository(NotificationSetting)
        private readonly notificationRepo: Repository<NotificationSetting>
    ) {}

    /**
     * Invites a new member to a company team.
     *
     * Validates that the acting user has permission to invite members, ensures the
     * invited email is not already associated with another membership, creates an
     * invitation record, and sends the invitation email after the transaction
     * completes successfully.
     *
     * @param companyId - The unique identifier of the company.
     * @param actingUserId - The unique identifier of the user sending the invite.
     * @param dto - The invitation details including email and assigned role.
     *
     * @returns void after the invitation has been created and sent.
     *
     * @throws {ForbiddenAppException}
     * If the acting user does not have permission to invite members.
     *
     * @throws {ResourceConflictException}
     * If the email has already been invited, is already a member, or cannot be
     * invited due to an existing membership.
     */
    async inviteMember(
        companyId: string,
        actingUserId: string,
        dto: InviteMemberDto
    ) {
        await this.requireManagerRole(actingUserId, companyId);

        const inviter = await this.userRoleRepo.findOne({
            where: {
                userId: actingUserId,
                companyId
            }
        });

        const savedInvite = await this.withTransaction(undefined, async trx => {
            const userRoleRepo = trx.getRepository(UserRole);

            /**
             * Check whether the email already has an existing membership.
             */
            const existingMembership = await userRoleRepo.findOne({
                where: {
                    email: dto.email
                }
            });

            if (existingMembership) {
                if (existingMembership.companyId === companyId) {
                    throw new ResourceConflictException(
                        "This person has already been invited or is already a member of your team."
                    );
                }

                throw new ResourceConflictException(
                    "This person cannot be invited because they are already associated with another team."
                );
            }

            await this.usageService.incrementTeamMemberCount(companyId, trx);

            const plainToken = generateInviteToken();

            const invite = userRoleRepo.create({
                userId: null,
                email: dto.email,
                companyId,
                name: null,
                role: dto.role,
                status: TeamMemberStatus.INVITED,
                invitedAt: new Date(),
                joinedAt: null,
                inviteTokenHash: hashInviteToken(plainToken),
                inviteTokenExpiresAt: getInviteTokenExpiry()
            });

            const saved = await userRoleRepo.save(invite);

            return {
                saved,
                plainToken
            };
        });

        // Send email only after the transaction commits successfully.
        await this.sendInviteEmail(
            savedInvite.saved,
            savedInvite.plainToken,
            inviter?.name ?? "A teammate"
        );
    }
    /**
     * Retrieves a driver by user ID within a specific company.
     *
     * Looks up the driver's team membership record to ensure the driver belongs
     * to the requested company. Returns null when no driver ID is provided or when
     * no matching driver is found.
     *
     * @param companyId - The unique identifier of the company.
     * @param userId - The unique identifier of the driver user.
     *
     * @returns The driver's company membership record or null if unavailable.
     */
    async getDriverByIdForCompany(companyId: string, userId: string | null) {
        if (!userId) {
            return null;
        }

        return await this.userRoleRepo.findOne({
            where: {
                userId,
                companyId
            }
        });
    }

    /**
     * Retrieves a paginated list of team members for a company.
     *
     * Supports searching by member name or email, filtering by roles, sorting,
     * and pagination. Only members belonging to the specified company are
     * returned.
     *
     * @param companyId - The unique identifier of the company.
     * @param query - The filtering, sorting, and pagination options.
     *
     * @returns A paginated list of team members.
     */
    async listTeamMembersForCompany(
        companyId: string,
        query: ListTeamMembersQueryDto
    ) {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;

        const qb = this.userRoleRepo
            .createQueryBuilder("member")
            .select([
                "member.id",
                "member.userId",
                "member.name",
                "member.email",
                "member.invitedAt",
                "member.joinedAt",
                "member.role",
                "member.status",
                "member.createdAt"
            ])
            .where("member.companyId = :companyId", {
                companyId
            });

        if (query.search) {
            qb.andWhere(
                "(member.email ILIKE :search OR member.name ILIKE :search)",
                {
                    search: `%${query.search}%`
                }
            );
        }

        if (query.roles?.length) {
            qb.andWhere("member.role IN (:...roles)", {
                roles: query.roles
            });
        }

        switch (query.sort) {
            case TeamSortKey.OLDEST:
                qb.orderBy("member.createdAt", "ASC");
                break;

            case TeamSortKey.NAME_AZ:
                qb.orderBy("member.name", "ASC", "NULLS LAST").addOrderBy(
                    "member.email",
                    "ASC"
                );
                break;

            default:
                qb.orderBy("member.createdAt", "DESC");
        }

        qb.skip((page - 1) * pageSize).take(pageSize);

        const [members, total] = await qb.getManyAndCount();

        return {
            members,
            total,
            page,
            pageSize
        };
    }

    async cancelInvite(
        companyId: string,
        actingUserId: string,
        memberId: string
    ): Promise<void> {
        await this.requireManagerRole(actingUserId, companyId);

        await this.withTransaction(undefined, async trx => {
            const member = await this.getMemberForCompany(
                memberId,
                companyId,
                trx
            );
            if (member.status !== TeamMemberStatus.INVITED) {
                throw new ForbiddenAppException(
                    "Only outstanding invites can be cancelled"
                );
            }
            await trx.getRepository(UserRole).remove(member);
            await this.usageService.decrementTeamMemberCount(companyId, trx);
        });
    }

    /**
     * Resends an invitation email to a pending team member.
     *
     * Verifies that the acting user has permission to manage team members,
     * confirms that the member has a pending invitation, generates a new secure
     * invite token, updates the invitation expiry, and sends a new invitation
     * email.
     *
     * The new invitation invalidates any previously sent invitation link.
     *
     * @param companyId - The unique identifier of the company.
     * @param actingUserId - The unique identifier of the user resending the invite.
     * @param memberId - The unique identifier of the invited member record.
     *
     * @returns void after the invitation has been resent.
     *
     * @throws {ForbiddenAppException}
     * If the acting user does not have permission to manage team members or the
     * invitation cannot be resent.
     *
     * @throws {ResourceNotFoundException}
     * If the member record could not be found.
     */
    async resendInvite(
        companyId: string,
        actingUserId: string,
        memberId: string
    ) {
        await this.requireManagerRole(actingUserId, companyId);

        const inviter = await this.userRoleRepo.findOne({
            where: {
                userId: actingUserId,
                companyId
            }
        });

        const member = await this.getMemberForCompany(memberId, companyId);

        if (member.status !== TeamMemberStatus.INVITED) {
            throw new ForbiddenAppException(
                "This invitation can no longer be resent."
            );
        }

        // Generate a new token so previously sent invitation links become invalid.
        const plainToken = generateInviteToken();

        member.inviteTokenHash = hashInviteToken(plainToken);
        member.inviteTokenExpiresAt = getInviteTokenExpiry();
        member.invitedAt = new Date();

        const saved = await this.userRoleRepo.save(member);

        await this.sendInviteEmail(
            saved,
            plainToken,
            inviter?.name ?? "A teammate"
        );
    }

    /**
     * Changes the role of a company team member.
     *
     * Ensures the acting user has permission to manage team members, validates
     * that the selected member can have their role updated, and saves the new
     * role assignment.
     *
     * @param companyId - The unique identifier of the company.
     * @param actingUserId - The unique identifier of the user changing the role.
     * @param memberId - The unique identifier of the member record.
     * @param dto - The new team role assignment.
     *
     * @returns void after the member role has been updated.
     *
     * @throws {ForbiddenAppException}
     * If the acting user does not have permission to manage members or the member
     * role cannot be changed.
     *
     * @throws {ResourceNotFoundException}
     * If the member could not be found.
     */
    async changeMemberRole(
        companyId: string,
        actingUserId: string,
        memberId: string,
        dto: ChangeRoleDto
    ) {
        await this.requireManagerRole(actingUserId, companyId);

        const member = await this.getMemberForCompany(memberId, companyId);

        if (member.role === TeamRoleType.OWNER) {
            throw new ForbiddenAppException(
                "This team member's role cannot be changed."
            );
        }

        // Prevent changing a driver's role while they have an active trip.
        if (
            member.role === TeamRoleType.DRIVER &&
            dto.role !== TeamRoleType.DRIVER &&
            member.userId &&
            (await this.isDriverAssignedToTrip(companyId, member.userId))
        ) {
            throw new ForbiddenAppException(
                "This driver is currently assigned to an active trip and their role cannot be changed."
            );
        }

        member.role = dto.role;

        await this.userRoleRepo.save(member);
    }

    /**
     * Removes a member from a company team.
     *
     * Removes the member's company association, updates usage tracking, deletes
     * stored user assets such as avatars, and removes the authentication account
     * after the database transaction completes successfully.
     *
     * @param companyId - The unique identifier of the company.
     * @param actingUserId - The unique identifier of the user performing removal.
     * @param memberId - The unique identifier of the member record.
     *
     * @returns void after the member has been removed.
     *
     * @throws {ForbiddenAppException}
     * If the acting user does not have permission to remove members or the member
     * cannot be removed.
     *
     * @throws {ResourceNotFoundException}
     * If the member could not be found.
     */
    async removeMember(
        companyId: string,
        actingUserId: string,
        memberId: string
    ): Promise<void> {
        await this.requireManagerRole(actingUserId, companyId);

        const removedMember = await this.withTransaction(
            undefined,
            async trx => {
                const member = await this.getMemberForCompany(
                    memberId,
                    companyId,
                    trx
                );

                if (member.role === TeamRoleType.OWNER) {
                    throw new ForbiddenAppException(
                        "This team member cannot be removed."
                    );
                }

                if (
                    member.role === TeamRoleType.DRIVER &&
                    member.userId &&
                    (await this.isDriverAssignedToTrip(
                        companyId,
                        member.userId
                    ))
                ) {
                    throw new ForbiddenAppException(
                        "This driver is currently assigned to an active trip and cannot be removed."
                    );
                }

                await trx.getRepository(UserRole).remove(member);

                await this.usageService.decrementTeamMemberCount(
                    companyId,
                    trx
                );

                return member;
            }
        );

        /**
         * Only remove Supabase account and assets after the database transaction
         * has completed successfully.
         */
        if (
            removedMember.status === TeamMemberStatus.ACTIVE &&
            removedMember.userId
        ) {
            try {
                const supabaseUser =
                    await this.usersService.getUserFromSupabase(
                        removedMember.userId
                    );

                const metadata = supabaseUser.user_metadata as Record<
                    string,
                    unknown
                > | null;

                const avatarExtension = metadata?.avatar_extension as
                    | string
                    | undefined;

                if (avatarExtension) {
                    await this.storageService.deleteFile(
                        StoragePath.userAvatar(
                            companyId,
                            removedMember.userId,
                            `avatar.${avatarExtension}`
                        )
                    );
                }

                await this.usersService.deleteSupabaseUser(
                    removedMember.userId
                );
            } catch (error) {
                this.logger.error(
                    `Failed to fully remove user ${removedMember.userId}.`,
                    error
                );

                throw new InternalErrorException(
                    "The member was removed from the team, but their account could not be fully removed."
                );
            }
        }
    }

    /**
     * Retrieves invitation details using an invitation token.
     *
     * Validates the invitation token and returns the information needed to display
     * the invitation acceptance page, including the invited email, company name,
     * and assigned role.
     *
     * @param token - The invitation token.
     *
     * @returns Invitation details required for accepting the invitation.
     *
     * @throws {ResourceNotFoundException}
     * If the invitation is invalid, expired, or no longer available.
     */
    async getInviteByToken(token: string): Promise<{
        email: string;
        companyName: string;
        roleLabel: string;
    }> {
        const invite = await this.findValidInviteByToken(token);

        const company = await this.dataSource.getRepository(Company).findOne({
            where: {
                id: invite.companyId
            }
        });

        return {
            email: invite.email,
            companyName: company?.name ?? "SmartTrack",
            roleLabel: ROLE_LABELS[invite.role]
        };
    }

    /**
     * Accepts a company invitation and creates the user's account.
     *
     * Validates the invitation token, creates a new authentication account,
     * activates the team membership, creates default notification settings, and
     * links the user to the company.
     *
     * @param dto - The invitation token, password, and user profile details.
     *
     * @returns The created user's ID and email address.
     *
     * @throws {ResourceConflictException}
     * If an account already exists or account creation fails.
     *
     * @throws {ResourceNotFoundException}
     * If the invitation is invalid, expired, or unavailable.
     */
    async acceptInvite(dto: AcceptInviteDto): Promise<{
        userId: string;
        email: string;
    }> {
        const invite = await this.findValidInviteByToken(dto.token);

        const { data, error } = await this.supabase.auth.admin.createUser({
            email: invite.email,
            password: dto.password,
            email_confirm: true,
            user_metadata: {
                full_name: dto.fullName
            }
        });

        if (error || !data?.user) {
            if (error?.message?.toLowerCase().includes("already")) {
                throw new ResourceConflictException(
                    "An account with this email already exists. Please sign in to continue."
                );
            }

            this.logger.error(
                `Failed to create account for invited user ${invite.email}.`,
                error
            );

            throw new ResourceConflictException(
                "We couldn't create your account. Please try again."
            );
        }

        invite.userId = data.user.id;
        invite.name = dto.fullName;
        invite.status = TeamMemberStatus.ACTIVE;
        invite.joinedAt = new Date();
        invite.inviteTokenHash = null;
        invite.inviteTokenExpiresAt = null;

        await this.userRoleRepo.save(invite);

        const userNotificationSettings = this.notificationRepo.create({
            userId: invite.userId
        });

        await this.notificationRepo.save(userNotificationSettings);

        return {
            userId: data.user.id,
            email: invite.email
        };
    }
    /**
     * Session-authenticated path — for someone who ALREADY has a SmartTrack
     * account (invited to a second company) and just logs in normally.
     * Trusting email here is safe because a real Supabase login already
     * proved ownership; this is NOT reachable without an active session.
     */
    async acceptPendingInvite(
        userId: string,
        email: string,
        name: string
    ): Promise<UserRole | null> {
        const invite = await this.userRoleRepo.findOne({
            where: { email, status: TeamMemberStatus.INVITED }
        });
        if (!invite) return null;

        invite.userId = userId;
        invite.name = name;
        invite.status = TeamMemberStatus.ACTIVE;
        invite.joinedAt = new Date();
        invite.inviteTokenHash = null;
        invite.inviteTokenExpiresAt = null;
        return this.userRoleRepo.save(invite);
    }

    /**
     * Retrieves available active drivers for a company.
     *
     * Finds all active drivers in the company, excludes drivers who currently
     * have pending or active delivery stops, and enriches the remaining drivers
     * with profile information such as avatar URL.
     *
     * @param companyId - The unique identifier of the company.
     *
     * @returns A list of available drivers with profile information.
     *
     * @throws {ExternalServiceException}
     * If user profile information cannot be retrieved.
     */
    async listAvailableDriversForCompany(companyId: string) {
        const drivers = await this.userRoleRepo.find({
            where: {
                companyId,
                role: TeamRoleType.DRIVER,
                status: TeamMemberStatus.ACTIVE
            }
        });

        if (drivers.length === 0) {
            return [];
        }

        const driverUserIds = drivers
            .map(d => d.userId)
            .filter((id): id is string => !!id);

        if (driverUserIds.length === 0) {
            return [];
        }

        const busyDriverIds = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .select("DISTINCT trip.driverUserId", "driverUserId")
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("trip.driverUserId IN (:...driverUserIds)", {
                driverUserIds
            })
            .andWhere("stop.status IN (:...statuses)", {
                statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
            })
            .getRawMany<{
                driverUserId: string;
            }>();

        const busySet = new Set(
            busyDriverIds.map(driver => driver.driverUserId)
        );

        const filteredAvailableDrivers = drivers.filter(
            driver => !!driver.userId && !busySet.has(driver.userId)
        );

        const availableDrivers: Record<string, any>[] = [];

        for (const driver of filteredAvailableDrivers) {
            if (!driver.userId) {
                continue;
            }

            const supabaseDriver = await this.usersService.getUserFromSupabase(
                driver.userId
            );

            availableDrivers.push({
                ...driver,
                avatarUrl:
                    (supabaseDriver.user_metadata as Record<string, unknown>)
                        ?.avatar_url ?? null
            });
        }

        return availableDrivers;
    }

    /**
     * Determines whether a driver is currently assigned to an active trip.
     *
     * A driver is considered assigned when they have at least one trip stop that
     * is still active. This is used to prevent removing a driver while they are
     * assigned to an ongoing trip.
     *
     * @param companyId - The unique identifier of the company.
     * @param driverUserId - The unique identifier of the driver's user account.
     * @param manager - Optional transaction manager.
     *
     * @returns `true` if the driver has an active trip assignment; otherwise `false`.
     */
    private async isDriverAssignedToTrip(
        companyId: string,
        driverUserId: string,
        manager?: EntityManager
    ): Promise<boolean> {
        const repo = (manager ?? this.dataSource).getRepository(TripStop);

        const assignment = await repo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .select("1")
            .where("trip.companyId = :companyId", { companyId })
            .andWhere("trip.driverUserId = :driverUserId", { driverUserId })
            .andWhere("stop.status IN (:...statuses)", {
                statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
            })
            .limit(1)
            .getRawOne();

        return !!assignment;
    }

    private async withTransaction<T>(
        manager: EntityManager | undefined,
        work: (manager: EntityManager) => Promise<T>
    ): Promise<T> {
        if (manager) return work(manager);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const result = await work(queryRunner.manager);
            await queryRunner.commitTransaction();
            return result;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    private async requireManagerRole(
        actingUserId: string,
        companyId: string
    ): Promise<void> {
        const actingRole = await this.userRoleRepo.findOne({
            where: { userId: actingUserId, companyId }
        });
        if (!actingRole || !MANAGER_ROLES.has(actingRole.role)) {
            throw new InsufficientPermissionsException("owner or admin");
        }
    }

    private async sendInviteEmail(
        invite: UserRole,
        plainToken: string,
        inviterName: string
    ): Promise<void> {
        const company = await this.dataSource
            .getRepository(Company)
            .findOne({ where: { id: invite.companyId } });
        const acceptUrl = `${this.config.get<string>(
            "CLIENT_URL"
        )}/accept-invite?token=${plainToken}`;

        await this.mailService.sendTemplateEmail({
            to: invite.email,
            subject: `You've been invited to join ${
                company?.name ?? "SmartTrack"
            }`,
            templateName: MailTemplate.TEAM_INVITE,
            context: {
                companyName: company?.name ?? "SmartTrack",
                inviterName,
                roleLabel: ROLE_LABELS[invite.role],
                acceptUrl
            }
        });
    }

    private async findValidInviteByToken(
        plainToken: string
    ): Promise<UserRole> {
        // Tokens aren't looked up by hash directly (HMAC output isn't
        // deterministic-lookup-friendly across all cases the same way a plain
        // hash would be — it is here, actually, since HMAC is deterministic
        // for a fixed secret+input, so a direct WHERE works). Scans pending
        // invites and verifies with timing-safe comparison for defense in
        // depth against any future change to the hashing scheme.
        const candidates = await this.userRoleRepo.find({
            where: { status: TeamMemberStatus.INVITED }
        });

        const match = candidates.find(
            c =>
                c.inviteTokenHash &&
                verifyInviteToken(plainToken, c.inviteTokenHash)
        );

        if (
            !match ||
            !match.inviteTokenExpiresAt ||
            match.inviteTokenExpiresAt < new Date()
        ) {
            throw new ResourceNotFoundException("This invite cannot be found");
        }

        return match;
    }

    private async getMemberForCompany(
        memberId: string,
        companyId: string,
        manager?: EntityManager
    ): Promise<UserRole> {
        const repo = manager
            ? manager.getRepository(UserRole)
            : this.userRoleRepo;
        const member = await repo.findOne({ where: { id: memberId } });
        if (!member)
            throw new ResourceNotFoundException(
                "This team member cannot be found"
            );
        if (member.companyId !== companyId) {
            throw new ForbiddenAppException(
                "This member does not belong to your company"
            );
        }
        return member;
    }
}
