import { Inject, Injectable } from "@nestjs/common";
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
    ResourceConflictException,
    ResourceNotFoundException,
    InternalErrorException
} from "#/common/exceptions";
import { SUPABASE_CLIENT } from "#/common/constants/supabase.constant";
import {
    generateInviteToken,
    getInviteTokenExpiry,
    hashInviteToken,
    verifyInviteToken
} from "#/common/utils/invite-token.util";
import { UsageService } from "#/modules/usage/usage.service";
import { MailService } from "#/modules/mail/mail.service";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ChangeRoleDto } from "./dto/change-role.dto";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import {
    ListTeamMembersQueryDto,
    TeamSortKey
} from "./dto/list-team-members.query.dto";

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
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        private readonly usageService: UsageService,
        private readonly mailService: MailService,
        private readonly config: ConfigService,
        @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient
    ) {}

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
             * Check if this email already belongs to any company.
             */
            const existingMembership = await userRoleRepo.findOne({
                where: {
                    email: dto.email
                }
            });

            if (existingMembership) {
                if (existingMembership.companyId === companyId) {
                    throw new ResourceConflictException(
                        "This user is already a member or has already been invited to this company."
                    );
                }

                throw new ResourceConflictException(
                    "This user already belongs to another company and cannot be invited."
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

        // Send email only after the transaction commits.
        await this.sendInviteEmail(
            savedInvite.saved,
            savedInvite.plainToken,
            inviter?.name ?? "A teammate"
        );
    }

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
            .where("member.companyId = :companyId", { companyId });

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

    async resendInvite(
        companyId: string,
        actingUserId: string,
        memberId: string
    ) {
        await this.requireManagerRole(actingUserId, companyId);

        const inviter = await this.userRoleRepo.findOne({
            where: { userId: actingUserId, companyId }
        });
        const member = await this.getMemberForCompany(memberId, companyId);
        if (member.status !== TeamMemberStatus.INVITED) {
            throw new ForbiddenAppException(
                "Only outstanding invites can be resent"
            );
        }

        // A fresh token invalidates the old link — the previous invite email's
        // URL stops working, which is the right behavior for "resend."
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
                "The owner's role can't be changed here"
            );
        }

        member.role = dto.role;
        await this.userRoleRepo.save(member);
    }

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
                        "The owner can never be removed"
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

        // Only delete from Supabase after the DB transaction commits successfully.
        if (
            removedMember.status === TeamMemberStatus.ACTIVE &&
            removedMember.userId
        ) {
            const { error } = await this.supabase.auth.admin.deleteUser(
                removedMember.userId
            );

            if (error) {
                throw new InternalErrorException(
                    "Member removed from company but failed to delete authentication account."
                );
            }
        }
    }
    /**
     * Public — resolves an invite token to display info (no email/password
     * required yet). Lets the accept-invite page show "Join Acme Logistics
     * as Dispatcher" and the email it's locked to, BEFORE the person submits
     * anything.
     */
    async getInviteByToken(
        token: string
    ): Promise<{ email: string; companyName: string; roleLabel: string }> {
        const invite = await this.findValidInviteByToken(token);
        const company = await this.dataSource
            .getRepository(Company)
            .findOne({ where: { id: invite.companyId } });
        return {
            email: invite.email,
            companyName: company?.name ?? "SmartTrack",
            roleLabel: ROLE_LABELS[invite.role]
        };
    }

    /**
     * Public, session-less acceptance path — the person has no Supabase
     * account or session yet. The token (not user input) determines which
     * invite/email this applies to, so nobody can claim a different
     * person's seat by editing the request. Creates a PRE-CONFIRMED Supabase
     * user via the Admin API, on the reasoning that clicking this exact link
     * already proves email ownership — the same proof a confirmation email
     * would otherwise provide, so we don't make them confirm twice.
     *
     * Does NOT establish a session — the frontend should immediately call
     * supabase.auth.signInWithPassword with the same credentials right after
     * this succeeds, keeping session handling in the same place it lives
     * everywhere else in the app.
     */
    async acceptInvite(
        dto: AcceptInviteDto
    ): Promise<{ userId: string; email: string }> {
        const invite = await this.findValidInviteByToken(dto.token);

        const { data, error } = await this.supabase.auth.admin.createUser({
            email: invite.email,
            password: dto.password,
            email_confirm: true,
            user_metadata: { full_name: dto.fullName }
        });

        if (error || !data?.user) {
            // Supabase's admin API returns a generic error for "email already
            // registered" rather than a distinct error code — matching on
            // message text is fragile; if this misfires, check the actual error
            // shape your installed @supabase/supabase-js version returns.
            if (error?.message?.toLowerCase().includes("already")) {
                throw new ResourceConflictException(
                    "An account with this email already exists. Log in, and your invite will be linked automatically."
                );
            }
            throw new ResourceConflictException(
                error?.message ?? "Could not create your account"
            );
        }

        invite.userId = data.user.id;
        invite.name = dto.fullName;
        invite.status = TeamMemberStatus.ACTIVE;
        invite.joinedAt = new Date();
        invite.inviteTokenHash = null;
        invite.inviteTokenExpiresAt = null;
        await this.userRoleRepo.save(invite);

        return { userId: data.user.id, email: invite.email };
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
            throw new ResourceNotFoundException("Invite");
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
            throw new ResourceNotFoundException("Team member", memberId);
        if (member.companyId !== companyId) {
            throw new ForbiddenAppException(
                "This member does not belong to your company"
            );
        }
        return member;
    }
}
