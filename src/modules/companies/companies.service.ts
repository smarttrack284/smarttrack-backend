import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Company } from '#/common/entities/company.entity';
import { NotificationSetting } from '#/common/entities/notification-setting.entity';
import { ResourceConflictException, ResourceNotFoundException, } from '#/common/exceptions';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UsersService } from '#/modules/users/users.service';
import { TeamRoleType } from '#/common/types/team-role.type';
import { UsageService } from '#/modules/usage/usage.service';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import { StorageService } from '#/common/storage/storage.service';
import { StoragePath } from '#/common/storage/storage-path.util';
import { UserRole } from '#/common/entities/user-role.entity';

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
    private readonly storageService: StorageService,
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
    manager?: EntityManager,
  ) {
    const supabaseUser =
      await this.usersService.getUserFromSupabase(ownerUserId);
    const ownerName =
      ((supabaseUser.user_metadata as Record<string, unknown> | null)
        ?.full_name as string | undefined) ??
      supabaseUser.email ??
      'Unknown';

    return this.withTransaction(manager, async (trx) => {
      // 1. Check for existing company
      const existing = await trx
        .getRepository(Company)
        .findOne({ where: { email: dto.email } });
      if (existing) {
        throw new ResourceConflictException(
          `A company with the email "${dto.email}" already exists`,
        );
      }

      // 2. Create and save the new company
      const company = trx.getRepository(Company).create({
        name: dto.name,
        email: dto.email,
        timezone: dto.timezone,
      });
      const saved = await trx.getRepository(Company).save(company);

      // 3. Provision subscription and usage
      await this.subscriptionsService.createSubscription(
        saved.id,
        SubscriptionPlan.FREE,
        trx,
      );
      await this.usageService.createUsage(saved.id, 1, trx);

      // 4. Create the owner user role record first (places the ownerUserId into the DB)
      await this.usersService.createUserRole(
        {
          userId: ownerUserId,
          companyId: saved.id,
          name: ownerName,
          email: supabaseUser.email as string,
          joinedAt: new Date(),
          status: TeamMemberStatus.ACTIVE,
          role: TeamRoleType.OWNER,
        },
        trx,
      );

      // 5. ✅ Create notification settings using the same Supabase UUID
      const userNotificationSettings = trx
        .getRepository(NotificationSetting)
        .create({
          userId: ownerUserId,
        });

      await trx
        .getRepository(NotificationSetting)
        .save(userNotificationSettings);

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
    const repo = manager ? manager.getRepository(Company) : this.companyRepo;
    const company = await repo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new ResourceNotFoundException('Company', companyId);
    }
    return this.standardCompanyData(company);
  }

  /** Returns null rather than throwing — used internally for uniqueness checks, not as a public "get" lookup. */
  async getCompanyByEmail(email: string, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(Company) : this.companyRepo;
    const company = await repo.findOne({ where: { email } });
    return this.standardCompanyData(company);
  }

  /**
   * `logoFile` is optional and separate from the rest of `dto` — if present,
   * it's uploaded FIRST (outside the DB transaction, since a storage upload
   * isn't something Postgres can roll back if it succeeds), and the
   * resulting public URL is what actually gets written to logoUrl. If the
   * upload fails, the method throws before touching the database at all —
   * no partial state where logoUrl points at something that doesn't exist.
   *
   * The uploaded path always resolves to the SAME file
   * (companies/{companyId}/logo/logo.{ext}) via upsert, rather than a new
   * randomly-named file each time — this means updating a logo replaces the
   * old one in place instead of accumulating orphaned old versions in
   * storage that nothing ever cleans up.
   */
  async updateCompany(
    companyId: string,
    dto: UpdateCompanyDto,
    logoFile?: { buffer: Buffer; contentType: string; extension: string },
    manager?: EntityManager,
  ) {
    let logoUrl: string | undefined;

    if (logoFile) {
      const path = StoragePath.companyLogo(
        companyId,
        `logo.${logoFile.extension}`,
      );
      logoUrl = await this.storageService.uploadFile({
        path,
        buffer: logoFile.buffer,
        contentType: logoFile.contentType,
      });
    }

    return this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(Company);
      const company = await repo.findOne({ where: { id: companyId } });
      if (!company) {
        throw new ResourceNotFoundException('Company', companyId);
      }

      if (dto.email && dto.email !== company.email) {
        const emailTaken = await repo.findOne({ where: { email: dto.email } });
        if (emailTaken) {
          throw new ResourceConflictException(
            `A company with the email "${dto.email}" already exists`,
          );
        }
      }

      Object.assign(company, dto);
      if (logoUrl) company.logoUrl = logoUrl;

      const saved = await repo.save(company);
      return this.standardCompanyData(saved);
    });
  }

  async deleteCompany(
    companyId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const affectedUserIds = await this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(Company);
      const company = await repo.findOne({ where: { id: companyId } });
      if (!company) throw new ResourceNotFoundException('Company', companyId);

      const memberships = await trx
        .getRepository(UserRole)
        .find({ where: { companyId }, select: { userId: true } });
      const userIds = memberships
        .map((m) => m.userId)
        .filter((id): id is string => !!id);

      // The company row's own onDelete: 'CASCADE' relations handle
      // UserRole/NotificationSetting/SavedLocation/ApiKey/Order/Trip
      // removal at the DB level automatically — this delete alone is
      // sufficient for everything IN this database.
      await repo.remove(company);

      return userIds;
    });

    await this.storageService.deleteFolder(StoragePath.companyRoot(companyId));

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
    work: (manager: EntityManager) => Promise<T>,
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
      logoUrl: company.logoUrl,
    };
  }
}
