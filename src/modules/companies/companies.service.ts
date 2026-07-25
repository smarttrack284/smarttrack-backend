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
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateSavedLocationDto } from './dto/update-saved-location.dto';
import { CreateSavedLocationDto } from './dto/create-saved-location.dto';
import { ApiKey } from '#/common/entities/api-key.entity';
import { buildApiKeyPreview, generateApiKey, } from '#/common/utils/api-key.util';
import { hashApiKey } from '#/common/utils/api-key-hash.util';
import { SavedLocation, SavedLocationKind, } from '#/common/entities/saved-location.entity';
import { ErrorHandlerService } from '#/common/errors/error-handler.service';

@Injectable()
export class CompaniesService {
  private logger = new Logger(CompaniesService.name);
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    @InjectRepository(SavedLocation)
    private readonly savedLocationRepo: Repository<SavedLocation>,
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly usageService: UsageService,
    private readonly storageService: StorageService,
    private readonly errorHandler: ErrorHandlerService,
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
    manager?: EntityManager,
  ) {
    try {
      const supabaseUser =
        await this.usersService.getUserFromSupabase(ownerUserId);

      const ownerName =
        ((supabaseUser.user_metadata as Record<string, unknown> | null)
          ?.full_name as string | undefined) ??
        supabaseUser.email ??
        'Unknown';

      return this.withTransaction(manager, async (trx) => {
        const companyRepo = trx.getRepository(Company);

        // Check if a company with the same email already exists.
        const existing = await companyRepo.findOne({
          where: { email: dto.email },
        });

        if (existing) {
          throw new ResourceConflictException(
            'A company with this email address already exists.',
          );
        }

        // Create and save the company.
        const company = companyRepo.create({
          name: dto.name,
          email: dto.email,
          timezone: dto.timezone,
        });

        const saved = await companyRepo.save(company);

        // Provision default subscription and usage tracking.
        await this.subscriptionsService.createSubscription(
          saved.id,
          SubscriptionPlan.FREE,
          trx,
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
            role: TeamRoleType.OWNER,
          },
          trx,
        );

        // Create default notification settings for the owner.
        const notificationSetting = trx
          .getRepository(NotificationSetting)
          .create({
            userId: ownerUserId,
          });

        await trx.getRepository(NotificationSetting).save(notificationSetting);

        return this.standardCompanyData(saved);
      });
    } catch (error) {
      this.errorHandler.handle(error, 'CompaniesService.createCompany');
    }
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
    try {
      const repo = manager ? manager.getRepository(Company) : this.companyRepo;

      const company = await repo.findOne({
        where: { id: companyId },
      });

      if (!company) {
        throw new ResourceNotFoundException(
          'The company you are looking for could not be found.',
        );
      }

      return this.standardCompanyData(company);
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.getCompanyById');
    }
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
    try {
      const repo = manager ? manager.getRepository(Company) : this.companyRepo;

      const company = await repo.findOne({
        where: { email },
      });

      if (!company) {
        throw new ResourceNotFoundException(
          'The requested company could not be found.',
        );
      }

      return this.standardCompanyData(company);
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.getCompanyByEmail');
    }
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
    manager?: EntityManager,
  ) {
    // Declare outside try block so we can access it in the catch block for cleanup
    let newUploadedLogoPath: string | undefined;

    try {
      return await this.withTransaction(manager, async (trx) => {
        const repo = trx.getRepository(Company);

        const company = await repo.findOne({
          where: { id: companyId },
        });

        if (!company) {
          throw new ResourceNotFoundException(
            'The company you are trying to update could not be found.',
          );
        }

        if (dto.email && dto.email !== company.email) {
          const emailTaken = await repo.findOne({
            where: { email: dto.email },
          });

          if (emailTaken) {
            throw new ResourceConflictException(
              'A company with this email address already exists.',
            );
          }
        }

        let logoUrl: string | undefined;
        let oldLogoPathToDelete: string | undefined;

        if (logoFile) {
          // Identify the old logo to delete LATER (after DB save succeeds)
          if (company.logoUrl) {
            const urlWithoutQuery = company.logoUrl.split('?')[0];
            const existingExtension = urlWithoutQuery.split('.').pop();

            if (existingExtension) {
              oldLogoPathToDelete = StoragePath.companyLogo(
                companyId,
                `logo.${existingExtension}`,
              );
            }
          }

          const extension = logoFile.extension.toLowerCase();
          newUploadedLogoPath = StoragePath.companyLogo(
            companyId,
            `logo.${extension}`,
          );

          logoUrl = await this.storageService.uploadFile({
            path: newUploadedLogoPath,
            buffer: logoFile.buffer,
            contentType: logoFile.contentType,
          });
        }

        Object.assign(company, dto);

        if (logoUrl) {
          company.logoUrl = logoUrl;
        }

        // Save to database first
        const saved = await repo.save(company);

        // Now that the DB save is successful, it is safe to delete the OLD logo
        // (We check to ensure we don't accidentally delete the new logo if the paths happen to be identical)
        if (
          oldLogoPathToDelete &&
          oldLogoPathToDelete !== newUploadedLogoPath
        ) {
          // Note: You can optionally wrap this in a try/catch so a failed deletion
          // doesn't crash the successful update response
          await this.storageService
            .deleteFile(oldLogoPathToDelete)
            .catch((err) => {
              this.logger.error(
                `Failed to delete old company logo: ${oldLogoPathToDelete}`,
                err,
              );
            });
        }

        return this.standardCompanyData(saved);
      });
    } catch (err) {
      // Rollback: If the transaction failed but we uploaded a new file, clean it up!
      if (newUploadedLogoPath) {
        try {
          await this.storageService.deleteFile(newUploadedLogoPath);
        } catch (cleanupErr) {
          // Log the cleanup error, but don't throw it so we preserve the original error
          this.logger.error(
            `Failed to clean up orphaned logo file after transaction failure: ${newUploadedLogoPath}`,
            cleanupErr,
          );
        }
      }

      this.errorHandler.handle(err, 'CompaniesService.updateCompany');
    }
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
    manager?: EntityManager,
  ): Promise<void> {
    try {
      const affectedUserIds = await this.withTransaction(
        manager,
        async (trx) => {
          const repo = trx.getRepository(Company);

          const company = await repo.findOne({
            where: { id: companyId },
          });

          if (!company) {
            throw new ResourceNotFoundException(
              'The company you are trying to delete could not be found.',
            );
          }

          const memberships = await trx.getRepository(UserRole).find({
            where: { companyId },
            select: { userId: true },
          });

          const userIds = memberships
            .map((m) => m.userId)
            .filter((id): id is string => !!id);

          // Database cascade rules handle removal of related records:
          // UserRole, NotificationSetting, SavedLocation, ApiKey,
          // Order, and Trip records.
          await repo.remove(company);

          return userIds;
        },
      );

      await this.storageService.deleteFolder(
        StoragePath.companyRoot(companyId),
      );

      for (const userId of affectedUserIds) {
        await this.usersService.deleteSupabaseUser(userId);
      }
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.deleteCompany');
    }
  }

  /**
   * Creates a new API key for a company.
   *
   * Generates a secure API key, stores only its hashed value for verification,
   * and returns the plaintext key only once during creation. The plaintext key
   * cannot be retrieved again after this operation.
   *
   * @param companyId - The unique identifier of the company.
   * @param dto - API key creation details including the display name.
   *
   * @returns The created API key details including the plaintext key shown once.
   *
   * @throws {ResourceNotFoundException}
   * If the company does not exist.
   */
  async createApiKeyForCompany(
    companyId: string,
    dto: CreateApiKeyDto,
  ): Promise<{
    id: string;
    name: string;
    key: string;
    keyPreview: string;
    createdAt: Date;
  }> {
    try {
      return this.withTransaction(undefined, async (trx) => {
        const companyRepo = trx.getRepository(Company);
        const apiKeyRepo = trx.getRepository(ApiKey);

        const company = await companyRepo.findOne({
          where: { id: companyId },
        });

        if (!company) {
          throw new ResourceNotFoundException(
            'The company associated with this API key could not be found.',
          );
        }

        const plainKey = generateApiKey('live');

        const keyHash = hashApiKey(plainKey);

        const keyPreview = buildApiKeyPreview(plainKey);

        const apiKey = apiKeyRepo.create({
          companyId,
          name: dto.name,
          keyHash,
          keyPreview,
          lastUsedAt: null,
          revokedAt: null,
        });

        const savedApiKey = await apiKeyRepo.save(apiKey);

        return {
          id: savedApiKey.id,
          name: savedApiKey.name,
          key: plainKey,
          keyPreview: savedApiKey.keyPreview,
          createdAt: savedApiKey.createdAt,
        };
      });
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.createApiKeyForCompany');
    }
  }

  /**
   * Retrieves all API keys for a company.
   *
   * Returns the API keys in descending order of creation date. Sensitive fields
   * such as the hashed key are never returned.
   *
   * @param companyId - The unique identifier of the company.
   *
   * @returns A list of API keys for the company.
   */
  async listApiKeysForCompany(companyId: string): Promise<
    {
      id: string;
      name: string;
      keyPreview: string;
      lastUsedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }[]
  > {
    try {
      const apiKeys = await this.apiKeyRepo.find({
        where: { companyId },
        order: {
          createdAt: 'DESC',
        },
      });

      return apiKeys.map((apiKey) => ({
        id: apiKey.id,
        name: apiKey.name,
        keyPreview: apiKey.keyPreview,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        createdAt: apiKey.createdAt,
      }));
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.listApiKeysForCompany');
    }
  }

  /**
   * Revokes an API key belonging to a company.
   *
   * Revoking a key immediately prevents it from being used while preserving it
   * for audit purposes. Revoked keys cannot be revoked again.
   *
   * @param companyId - The unique identifier of the company.
   * @param apiKeyId - The unique identifier of the API key.
   *
   * @returns The revoked API key details.
   *
   * @throws {ResourceNotFoundException}
   * If the API key does not exist for the company.
   *
   * @throws {ResourceConflictException}
   * If the API key has already been revoked.
   */
  async revokeApiKeyForCompany(
    companyId: string,
    apiKeyId: string,
  ): Promise<{
    id: string;
    name: string;
    keyPreview: string;
    revokedAt: Date;
  }> {
    try {
      return this.withTransaction(undefined, async (trx) => {
        const apiKeyRepo = trx.getRepository(ApiKey);

        const apiKey = await apiKeyRepo.findOne({
          where: {
            id: apiKeyId,
            companyId,
          },
        });

        if (!apiKey) {
          throw new ResourceNotFoundException(
            'The requested API key could not be found.',
          );
        }

        if (apiKey.revokedAt) {
          throw new ResourceConflictException(
            'This API key has already been revoked.',
          );
        }

        apiKey.revokedAt = new Date();

        const saved = await apiKeyRepo.save(apiKey);

        return {
          id: saved.id,
          name: saved.name,
          keyPreview: saved.keyPreview,
          revokedAt: saved.revokedAt!,
        };
      });
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.revokeApiKeyForCompany');
    }
  }

  /**
   * Creates a saved location for a company.
   *
   * Saved locations allow companies to quickly reuse frequently visited
   * destinations such as warehouses, offices, depots, or customer sites.
   *
   * @param companyId - The unique identifier of the company.
   * @param dto - The saved location details.
   *
   * @returns The newly created saved location.
   *
   * @throws {ResourceNotFoundException}
   * If the specified company does not exist.
   */
  async createSavedLocation(
    companyId: string,
    dto: CreateSavedLocationDto,
  ): Promise<{
    id: string;
    label: string;
    address: string;
    lat: number;
    lng: number;
    kind: SavedLocationKind | null;
    createdAt: Date;
  }> {
    try {
      return this.withTransaction(undefined, async (trx) => {
        const companyRepo = trx.getRepository(Company);
        const savedLocationRepo = trx.getRepository(SavedLocation);

        const company = await companyRepo.findOne({
          where: { id: companyId },
        });

        if (!company) {
          throw new ResourceNotFoundException(
            'The requested company could not be found.',
          );
        }

        const savedLocation = savedLocationRepo.create({
          companyId,
          label: dto.label,
          address: dto.address,
          lat: dto.lat,
          lng: dto.lng,
          kind: dto.kind ?? null,
        });

        const saved = await savedLocationRepo.save(savedLocation);

        return {
          id: saved.id,
          label: saved.label,
          address: saved.address,
          lat: saved.lat,
          lng: saved.lng,
          kind: saved.kind,
          createdAt: saved.createdAt,
        };
      });
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.createSavedLocation');
    }
  }

  /**
   * Retrieves all saved locations for a company.
   *
   * Returns the company's saved locations ordered alphabetically by label.
   *
   * @param companyId - The unique identifier of the company.
   *
   * @returns A list of saved locations.
   */
  async listSavedLocations(companyId: string): Promise<
    {
      id: string;
      label: string;
      address: string;
      lat: number;
      lng: number;
      kind: SavedLocationKind | null;
      createdAt: Date;
    }[]
  > {
    try {
      const savedLocations = await this.savedLocationRepo.find({
        where: {
          companyId,
        },
        order: {
          label: 'ASC',
        },
      });

      return savedLocations.map((location) => ({
        id: location.id,
        label: location.label,
        address: location.address,
        lat: location.lat,
        lng: location.lng,
        kind: location.kind,
        createdAt: location.createdAt,
      }));
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.listSavedLocations');
    }
  }

  /**
   * Retrieves a saved location belonging to a company.
   *
   * @param companyId - The unique identifier of the company.
   * @param savedLocationId - The unique identifier of the saved location.
   *
   * @returns The requested saved location.
   *
   * @throws {ResourceNotFoundException}
   * If the saved location does not exist for the company.
   */
  async getSavedLocation(
    companyId: string,
    savedLocationId: string,
  ): Promise<{
    id: string;
    label: string;
    address: string;
    lat: number;
    lng: number;
    kind: SavedLocationKind | null;
    createdAt: Date;
  }> {
    try {
      const location = await this.savedLocationRepo.findOne({
        where: {
          id: savedLocationId,
          companyId,
        },
      });

      if (!location) {
        throw new ResourceNotFoundException(
          'The requested saved location could not be found.',
        );
      }

      return {
        id: location.id,
        label: location.label,
        address: location.address,
        lat: location.lat,
        lng: location.lng,
        kind: location.kind,
        createdAt: location.createdAt,
      };
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.getSavedLocation');
    }
  }

  /**
   * Updates a saved location belonging to a company.
   *
   * Updates the details of an existing saved location. The operation is executed
   * within a transaction to ensure consistency.
   *
   * @param companyId - The unique identifier of the company.
   * @param savedLocationId - The unique identifier of the saved location.
   * @param dto - The updated saved location details.
   *
   * @returns The updated saved location.
   *
   * @throws {ResourceNotFoundException}
   * If the saved location does not exist for the company.
   */
  async updateSavedLocation(
    companyId: string,
    savedLocationId: string,
    dto: UpdateSavedLocationDto,
  ): Promise<{
    id: string;
    label: string;
    address: string;
    lat: number;
    lng: number;
    kind: SavedLocationKind | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      return this.withTransaction(undefined, async (trx) => {
        const savedLocationRepo = trx.getRepository(SavedLocation);

        const location = await savedLocationRepo.findOne({
          where: {
            id: savedLocationId,
            companyId,
          },
        });

        if (!location) {
          throw new ResourceNotFoundException(
            'The requested saved location could not be found.',
          );
        }

        location.label = dto.label ?? location.label;
        location.address = dto.address ?? location.address;
        location.lat = dto.lat ?? location.lat;
        location.lng = dto.lng ?? location.lng;
        location.kind = dto.kind ?? location.kind;

        const updated = await savedLocationRepo.save(location);

        return {
          id: updated.id,
          label: updated.label,
          address: updated.address,
          lat: updated.lat,
          lng: updated.lng,
          kind: updated.kind,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      });
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.updateSavedLocation');
    }
  }

  /**
   * Deletes a saved location belonging to a company.
   *
   * Permanently removes the saved location. The operation is executed within a
   * transaction to ensure consistency.
   *
   * @param companyId - The unique identifier of the company.
   * @param savedLocationId - The unique identifier of the saved location.
   *
   * @throws {ResourceNotFoundException}
   * If the saved location does not exist for the company.
   */
  async deleteSavedLocation(
    companyId: string,
    savedLocationId: string,
  ): Promise<void> {
    try {
      return this.withTransaction(undefined, async (trx) => {
        const savedLocationRepo = trx.getRepository(SavedLocation);

        const location = await savedLocationRepo.findOne({
          where: {
            id: savedLocationId,
            companyId,
          },
        });

        if (!location) {
          throw new ResourceNotFoundException(
            'The requested saved location could not be found.',
          );
        }

        await savedLocationRepo.remove(location);
      });
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.deleteSavedLocation');
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
