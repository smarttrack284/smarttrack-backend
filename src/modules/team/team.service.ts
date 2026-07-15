import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { UserRole } from "#/common/entities/user-role.entity";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import { TeamRoleType } from "#/common/types/team-role.type";
import {
    ForbiddenAppException,
    InsufficientPermissionsException,
    ResourceConflictException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { UsageService } from "#/modules/usage/usage.service";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ChangeRoleDto } from "./dto/change-role.dto";
import {
    ListTeamMembersQueryDto,
    TeamSortKey
} from "./dto/list-team-members.query.dto";

const MANAGER_ROLES = new Set<TeamRoleType>([
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN
]);

@Injectable()
export class TeamService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        private readonly usageService: UsageService
    ) {}

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

    /** Only owner/admin can invite, change roles, or remove members — mirrors the frontend's action-menu gating, enforced server-side rather than trusted from client UI alone. */
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

    /**
     * Creates an INVITED row — no Supabase account required to exist yet.
     * Reserves a usage seat immediately (see UsageService.incrementTeamMemberCount),
     * since an outstanding invite represents a seat the company intends to
     * fill, same as the frontend treating "Invited" as a real row in the
     * team table, not a separate concept.
     *
     * TODO: sending the actual invite email isn't implemented — this method
     * only creates the database row. Wire in an email provider before this
     * is usable end-to-end.
     */
    async inviteMember(
        companyId: string,
        actingUserId: string,
        dto: InviteMemberDto
    ): Promise<UserRole> {
        await this.requireManagerRole(actingUserId, companyId);

        return this.withTransaction(undefined, async trx => {
            const existing = await trx.getRepository(UserRole).findOne({
                where: { email: dto.email, companyId }
            });
            if (existing) {
                throw new ResourceConflictException(
                    "This email already has a role in your team"
                );
            }

            await this.usageService.incrementTeamMemberCount(companyId, trx);

            const invite = trx.getRepository(UserRole).create({
                userId: null,
                email: dto.email,
                companyId,
                name: null,
                role: dto.role,
                status: TeamMemberStatus.INVITED,
                invitedAt: new Date(),
                joinedAt: null
            });
            return trx.getRepository(UserRole).save(invite);
        });
    }

    async listTeamMembersForCompany(
        companyId: string,
        query: ListTeamMembersQueryDto
    ) {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;

        const qb = this.userRoleRepo
            .createQueryBuilder("member")
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
            qb.andWhere("member.role IN (:...roles)", { roles: query.roles });
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
        return { members, total, page, pageSize };
    }

    /** Revokes an outstanding invite — releases the usage seat it reserved. Only valid on INVITED rows; an active member is removed via removeMember instead. */
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

    /** Refreshes invitedAt so the invite doesn't read as stale — the actual re-send email is a TODO, same as inviteMember's. */
    async resendInvite(
        companyId: string,
        actingUserId: string,
        memberId: string
    ): Promise<UserRole> {
        await this.requireManagerRole(actingUserId, companyId);

        const member = await this.getMemberForCompany(memberId, companyId);
        if (member.status !== TeamMemberStatus.INVITED) {
            throw new ForbiddenAppException(
                "Only outstanding invites can be resent"
            );
        }

        member.invitedAt = new Date();
        return this.userRoleRepo.save(member);
    }

    /** The owner's role can never be changed through this method — a company always needs at least one owner, and this module has no "transfer ownership" flow. */
    async changeMemberRole(
        companyId: string,
        actingUserId: string,
        memberId: string,
        dto: ChangeRoleDto
    ): Promise<UserRole> {
        await this.requireManagerRole(actingUserId, companyId);

        const member = await this.getMemberForCompany(memberId, companyId);
        if (member.role === TeamRoleType.OWNER) {
            throw new ForbiddenAppException(
                "The owner's role can't be changed here"
            );
        }

        member.role = dto.role;
        return this.userRoleRepo.save(member);
    }

    /** Removes an ACTIVE member. The owner can never be removed this way, same reasoning as changeMemberRole. */
    async removeMember(
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
            if (member.role === TeamRoleType.OWNER) {
                throw new ForbiddenAppException(
                    "The owner can never be removed"
                );
            }

            await trx.getRepository(UserRole).remove(member);
            await this.usageService.decrementTeamMemberCount(companyId, trx);
        });
    }

    /**
     * Links a newly-signed-up Supabase user to their pending invite by
     * email — call this from your sign-up flow, after Supabase account
     * creation succeeds, matching the new user's email against any INVITED
     * row for that email. NOT wired into the sign-up route yet; this is the
     * method that flow needs to call once it exists.
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
        return this.userRoleRepo.save(invite);
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
