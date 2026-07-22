import { Injectable, Logger } from "@nestjs/common";
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
import { StorageService } from "#/common/storage/storage.service";
import { StoragePath } from "#/common/storage/storage-path.util";
import { UserRole } from "#/common/entities/user-role.entity";

@Injectable()
export class CompaniesService {
    private logger = new Logger(CompaniesService.name);
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        private readonly usersService: UsersService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly usageService: UsageService,
        private readonly storageService: StorageService
    ) {}

    /**
     * Creates a new company and provisions its initial resources.
     *
     * Creates the company record, sets up the default subscription and usage
     * tracking, assigns the creating user as the company owner, and creates
     * default notification settings for the owner.
     *
     * @param dto - The company information to create.
     * @param ownerUserId - The unique identifier of the user creating the company.
     * @param manager - Optional transaction entity manager.
     *
     * @returns The created company with standard company information.
     *
     * @throws {ResourceConflictException}
     * If a company with the same email address already exists.
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
            const companyRepo = trx.getRepository(Company);

            // Check if a company with the same email already exists.
            const existing = await companyRepo.findOne({
                where: { email: dto.email }
            });

            if (existing) {
                throw new ResourceConflictException(
                    "A company with this email address already exists."
                );
            }

            // Create and save the company.
            const company = companyRepo.create({
                name: dto.name,
                email: dto.email,
                timezone: dto.timezone
            });

            const saved = await companyRepo.save(company);

            // Provision default subscription and usage tracking.
            await this.subscriptionsService.createSubscription(
                saved.id,
                SubscriptionPlan.FREE,
                trx
            );

            await this.usageService.createUsage(saved.id, 1, trx);

            // Assign the creator as the company owner.
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

            // Create default notification settings for the owner.
            const userNotificationSettings = trx
                .getRepository(NotificationSetting)
                .create({
                    userId: ownerUserId
                });

            await trx
                .getRepository(NotificationSetting)
                .save(userNotificationSettings);

            return this.standardCompanyData(saved);
        });
    }

    /**
     * Retrieves a company by its unique identifier.
     *
     * @param companyId - The unique identifier of the company.
     * @param manager - Optional transaction entity manager.
     *
     * @returns The company information.
     *
     * @throws {ResourceNotFoundException}
     * If the company could not be found.
     */
    async getCompanyById(companyId: string, manager?: EntityManager) {
        const repo = manager
            ? manager.getRepository(Company)
            : this.companyRepo;

        const company = await repo.findOne({
            where: { id: companyId }
        });

        if (!company) {
            throw new ResourceNotFoundException(
                "Company",
                "The company you are looking for could not be found."
            );
        }

        return this.standardCompanyData(company);
    }

    /**
     * Retrieves a company by its email address.
     *
     * @param email - The company's email address.
     * @param manager - Optional transaction entity manager.
     *
     * @returns The company information.
     *
     * @throws {ResourceNotFoundException}
     * If no company exists with the provided email address.
     */
    async getCompanyByEmail(email: string, manager?: EntityManager) {
        const repo = manager
            ? manager.getRepository(Company)
            : this.companyRepo;

        const company = await repo.findOne({
            where: { email }
        });

        if (!company) {
            throw new ResourceNotFoundException(
                "Company",
                "The requested company could not be found."
            );
        }

        return this.standardCompanyData(company);
    }

    /**
     * Updates company information.
     *
     * Updates the company's details and optionally uploads a new company logo.
     * The company email can only be changed if the new email address is not
     * already associated with another company.
     *
     * @param companyId - The unique identifier of the company.
     * @param dto - The company information to update.
     * @param logoFile - Optional company logo file to upload.
     * @param manager - Optional transaction entity manager.
     *
     * @returns The updated company information.
     *
     * @throws {ResourceNotFoundException}
     * If the company could not be found.
     *
     * @throws {ResourceConflictException}
     * If another company already uses the provided email address.
     */
    async updateCompany(
        companyId: string,
        dto: UpdateCompanyDto,
        logoFile?: {
            buffer: Buffer;
            contentType: string;
            extension: string;
        },
        manager?: EntityManager
    ) {
        let logoUrl: string | undefined;

        if (logoFile) {
            const path = StoragePath.companyLogo(
                companyId,
                `logo.${logoFile.extension}`
            );

            logoUrl = await this.storageService.uploadFile({
                path,
                buffer: logoFile.buffer,
                contentType: logoFile.contentType
            });
        }

        return this.withTransaction(manager, async trx => {
            const repo = trx.getRepository(Company);

            const company = await repo.findOne({
                where: { id: companyId }
            });

            if (!company) {
                throw new ResourceNotFoundException(
                    "Company",
                    "The company you are trying to update could not be found."
                );
            }

            if (dto.email && dto.email !== company.email) {
                const emailTaken = await repo.findOne({
                    where: { email: dto.email }
                });

                if (emailTaken) {
                    throw new ResourceConflictException(
                        "A company with this email address already exists."
                    );
                }
            }

            Object.assign(company, dto);

            if (logoUrl) {
                company.logoUrl = logoUrl;
            }

            const saved = await repo.save(company);

            return this.standardCompanyData(saved);
        });
    }

    /**
 * Deletes a company and all associated resources.
 *
 * Removes the company record and relies on database cascade rules to clean up
 * related records such as memberships, notification settings, locations,
 * API keys, orders, and trips. It also removes company storage files and
 * deletes associated Supabase user accounts.
 *
 * @param companyId - The unique identifier of the company.
 * @param manager - Optional transaction entity manager.
 *
 * @throws {ResourceNotFoundException}
 * If the company could not be found.
 */
async deleteCompany(
    companyId: string,
    manager?: EntityManager
): Promise<void> {
    const affectedUserIds = await this.withTransaction(
        manager,
        async trx => {
            const repo = trx.getRepository(Company);

            const company = await repo.findOne({
                where: { id: companyId }
            });

            if (!company) {
                throw new ResourceNotFoundException(
                    "Company",
                    "The company you are trying to delete could not be found."
                );
            }

            const memberships = await trx
                .getRepository(UserRole)
                .find({
                    where: { companyId },
                    select: { userId: true }
                });

            const userIds = memberships
                .map(m => m.userId)
                .filter((id): id is string => !!id);

            // Database cascade rules handle removal of related records:
            // UserRole, NotificationSetting, SavedLocation, ApiKey,
            // Order, and Trip records.
            await repo.remove(company);

            return userIds;
        }
    );

    await this.storageService.deleteFolder(
        StoragePath.companyRoot(companyId)
    );

    for (const userId of affectedUserIds) {
        await this.usersService.deleteSupabaseUser(userId);
    }
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
