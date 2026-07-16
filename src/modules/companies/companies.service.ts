import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Company } from "#/common/entities/company.entity";
import { NotificationSetting } from "#/common/entities/notification-setting.entity";
import {
    ResourceConflictException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { UsersService } from "#/modules/users/users.service";
import { TeamRoleType } from "#/common/types/team-role.type";
import { UsageService } from "#/modules/usage/usage.service";
import { SubscriptionsService } from "#/modules/subscriptions/subscriptions.service";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";

@Injectable()
export class CompaniesService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        private readonly usersService: UsersService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly usageService: UsageService
    ) {}

    /**
     * Creates a company and everything it needs to function on day one, all
     * in ONE transaction: notification settings, a FREE subscription, usage
     * tracking, and the requesting user's "owner" role. If any step fails,
     * everything rolls back — there is no state where a company exists
     * without a subscription, without usage tracking, or without an owner.
     *
     * `ownerUserId` must come from SupabaseAuthGuard via @CurrentUser() at
     * the controller — never from the request body.
     */
    async createCompany(
        dto: CreateCompanyDto,
        ownerUserId: string,
        manager?: EntityManager
    ) {
        const supabaseUser =
            await this.usersService.getUserFromSupabase(ownerUserId);
        const ownerName =
            ((supabaseUser.user_metadata as Record<string, unknown> | null)
                ?.full_name as string | undefined) ??
            supabaseUser.email ??
            "Unknown";

        return this.withTransaction(manager, async trx => {
            const existing = await trx
                .getRepository(Company)
                .findOne({ where: { email: dto.email } });
            if (existing) {
                throw new ResourceConflictException(
                    `A company with the email "${dto.email}" already exists`
                );
            }

            const company = trx.getRepository(Company).create({
                name: dto.name,
                email: dto.email,
                timezone: dto.timezone
            });
            const saved = await trx.getRepository(Company).save(company);

            const settings = trx
                .getRepository(NotificationSetting)
                .create({ companyId: saved.id });
            await trx.getRepository(NotificationSetting).save(settings);

            await this.subscriptionsService.createSubscription(
                saved.id,
                SubscriptionPlan.FREE,
                trx
            );
            await this.usageService.createUsage(saved.id, 1, trx);

            await this.usersService.createUserRole(
                {
                    userId: ownerUserId,
                    companyId: saved.id,
                    name: ownerName,
                    email: supabaseUser.email as string,
                    joinedAt: new Date(),
                    status: TeamMemberStatus.ACTIVE,
                    role: TeamRoleType.OWNER
                },
                trx
            );

            return this.standardCompanyData(saved);
        });
    }

    /**
     * Read-only — no transaction needed for a single lookup, but still
     * accepts `manager` so it can be called consistently from inside another
     * service's transaction (e.g. reading a company as part of a larger
     * multi-step write) without opening a second connection.
     */
    async getCompanyById(companyId: string, manager?: EntityManager) {
        const repo = manager
            ? manager.getRepository(Company)
            : this.companyRepo;
        const company = await repo.findOne({ where: { id: companyId } });
        if (!company) {
            throw new ResourceNotFoundException("Company", companyId);
        }
        return this.standardCompanyData(company);
    }

    /** Returns null rather than throwing — used internally for uniqueness checks, not as a public "get" lookup. */
    async getCompanyByEmail(email: string, manager?: EntityManager) {
        const repo = manager
            ? manager.getRepository(Company)
            : this.companyRepo;
        const company = await repo.findOne({ where: { email } });
        return this.standardCompanyData(company);
    }

    async updateCompany(
        companyId: string,
        dto: UpdateCompanyDto,
        manager?: EntityManager
    ) {
        return this.withTransaction(manager, async trx => {
            const repo = trx.getRepository(Company);
            const company = await repo.findOne({ where: { id: companyId } });
            if (!company) {
                throw new ResourceNotFoundException("Company", companyId);
            }

            if (dto.email && dto.email !== company.email) {
                const emailTaken = await repo.findOne({
                    where: { email: dto.email }
                });
                if (emailTaken) {
                    throw new ResourceConflictException(
                        `A company with the email "${dto.email}" already exists`
                    );
                }
            }

            Object.assign(company, dto);
            const saved = await repo.save(company);
            return this.standardCompanyData(saved);
        });
    }

    /**
     * Hard-deletes the company. Related rows (notification settings, saved
     * locations, api keys) are removed via each entity's `onDelete: 'CASCADE'`
     * foreign key, at the database level, so this stays one clean delete
     * rather than manually deleting each relation first.
     *
     * If you need an audit trail of deleted companies later (who deleted it,
     * when, for support/compliance reasons), that's a soft-delete column
     * (`@DeleteDateColumn`) worth adding deliberately — not something to
     * silently assume is or isn't needed here.
     */
    async deleteCompany(
        companyId: string,
        manager?: EntityManager
    ): Promise<void> {
        await this.withTransaction(manager, async trx => {
            const repo = trx.getRepository(Company);
            const company = await repo.findOne({ where: { id: companyId } });
            if (!company) {
                throw new ResourceNotFoundException("Company", companyId);
            }
            await repo.remove(company);
        });
    }

    /**
     * Runs `work` inside a transaction.
     *
     * If `manager` is already provided (the caller is already inside a
     * transaction it owns — e.g. a future onboarding flow that creates a
     * user profile and a company together), this just participates in that
     * transaction rather than starting a nested one.
     *
     * If `manager` is undefined, this method owns the full lifecycle: opens
     * a QueryRunner, starts a transaction, commits on success, rolls back
     * and rethrows on failure, and always releases the connection.
     *
     * This is what makes every write method below safe to call both as a
     * standalone operation from CompaniesController, AND as one step inside
     * a larger multi-entity transaction from another module's service.
     */
    private async withTransaction<T>(
        manager: EntityManager | undefined,
        work: (manager: EntityManager) => Promise<T>
    ): Promise<T> {
        if (manager) {
            return work(manager);
        }

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

    private standardCompanyData(company: Company | null) {
        if (!company) return;
        return {
            id: company.id,
            name: company.name,
            email: company.email,
            timezone: company.timezone,
            logoUrl: company.logoUrl
        };
    }
}
