import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository, } from 'typeorm';
import { Company } from '#/common/entities/company.entity';
// import { NotificationSetting } from "#/common/entities/notification-setting.entity";
import { InternalErrorException, ResourceConflictException, ResourceNotFoundException, } from '#/common/exceptions';
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
import { UpdateSavedLocationDto } from './dto/update-saved-location.dto';
import { CreateSavedLocationDto } from './dto/create-saved-location.dto';
import { ApiKey } from '#/common/entities/api-key.entity';
import { SavedLocation, SavedLocationKind, } from '#/common/entities/saved-location.entity';
import { ErrorHandlerService, rule, } from '#/common/errors/error-handler.service';
import { randomUUID } from 'crypto';
import { CompanyNotificationSetting } from '#/common/entities/company-notification-settings.entity';
import { UpdateCompanyNotificationDto } from './dto/update-company-notification.dto';

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
    @InjectRepository(CompanyNotificationSetting)
    private readonly companyNotificationRepo: Repository<CompanyNotificationSetting>,
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

      if (!supabaseUser) {
        throw new Error(
          `Supabase user ${ownerUserId} not found during company creation`,
        );
      }

      const ownerName =
        ((supabaseUser.user_metadata as Record<string, unknown> | null)
          ?.full_name as string | undefined) ??
        supabaseUser.email ??
        'Unknown';

      return this.withTransaction(manager, async (trx) => {
        const companyRepo = trx.getRepository(Company);


        const existing = await companyRepo.findOne({
          where: { email: dto.email },
        });

        if (existing) {
          throw new ResourceConflictException(
            'A company with this email address already exists.',
          );
        }

        const company = companyRepo.create({
          name: dto.name,
          email: dto.email,
          timezone: dto.timezone,
        });

        const saved = await companyRepo.save(company);

        await this.subscriptionsService.createSubscription(
          saved.id,
          SubscriptionPlan.FREE,
          trx,
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
            role: TeamRoleType.OWNER,
          },
          trx,
        );

        const companyNotificationSetting = trx
          .getRepository(CompanyNotificationSetting)
          .create({
            companyId: saved.id,
          });

        await trx
          .getRepository(CompanyNotificationSetting)
          .save(companyNotificationSetting);

        return this.standardCompanyData(saved);
      });
    } catch (error) {
      this.errorHandler.handle(error, 'CompaniesService.createCompany', [
        rule(QueryFailedError, (e) => {
         
          const pgError = (
            e as unknown as {
              driverError?: {
                code?: string;
                constraint?: string;
                detail?: string;
              };
            }
          ).driverError;

          const isUniqueViolation = pgError?.code === '23505';
          const isEmailConstraint =
            pgError?.constraint?.toLowerCase().includes('email') ||
            pgError?.detail?.toLowerCase().includes('email');

          if (isUniqueViolation && isEmailConstraint) {
            return new ResourceConflictException(
              'A company with this email address already exists.',
            );
          }

          return new InternalErrorException(
            'Something went wrong. Please try again later.',
          );
        }),
      ]);
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

      return company;
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.getCompanyById', [
        rule(QueryFailedError, (e) => {
          // connection terminated unexpectedly, etc.
          if (e.message.includes('Connection terminated')) {
            return new InternalErrorException(
              'The service is temporarily unavailable. Please try again shortly.',
            );
          }
          // fallback: still safe
          return new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          );
        }),
      ]);
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
        let oldLogoPath: string | undefined;

        if (logoFile) {
          if (company.logoFilename) {
            oldLogoPath = StoragePath.companyLogo(
              companyId,
              company.logoFilename,
            );
          }

          const extension = logoFile.extension.toLowerCase();
          const filename = `logo-${randomUUID()}.${extension}`;

          newUploadedLogoPath = StoragePath.companyLogo(companyId, filename);

          logoUrl = await this.storageService.uploadFile({
            path: newUploadedLogoPath,
            buffer: logoFile.buffer,
            contentType: logoFile.contentType,
          });

          company.logoUrl = logoUrl;
          company.logoFilename = filename;
        }

        Object.assign(company, dto);

        const saved = await repo.save(company);

        if (oldLogoPath) {
          await this.storageService.deleteFile(oldLogoPath).catch((err) => {
            this.logger.error(
              `Failed to delete old company logo: ${oldLogoPath}`,
              err,
            );
          });
        }

        return this.standardCompanyData(saved);
      });
    } catch (err) {
      // Cleanup first – never swallow the original error.
      if (newUploadedLogoPath) {
        await this.storageService
          .deleteFile(newUploadedLogoPath)
          .catch((cleanupErr) =>
            this.logger.error(
              `Failed cleaning uploaded logo: ${newUploadedLogoPath}`,
              cleanupErr,
            ),
          );
      }

      this.errorHandler.handle(err, 'CompaniesService.updateCompany', [
        // Map known database constraint violations (beyond the manual
        // email check) to a generic conflict message that doesn't
        // reveal which column caused the problem.
        rule(QueryFailedError, (e) => {
          const pg = (e as any).driverError;
          if (pg?.code === '23505') {
            return new ResourceConflictException(
              'This change conflicts with an existing company record.',
            );
          }
          // Not a unique violation – let the generic handler deal with it.
          return new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          );
        }),

        // Handle storage service errors gracefully. If your storage
        // service throws a custom error class, use that here; otherwise
        // catch a broad Error type but only if the message indicates a
        // file operation failure. This keeps the response friendly while
        // still logging the real error.
        rule(Error, (e) => {
          if (
            e.message.includes('Storage') ||
            e.message.includes('upload') ||
            e.message.includes('file')
          ) {
            return new InternalErrorException(
              'Unable to process the uploaded file. Please try again.',
            );
          }
          // Let other unknown errors fall through to the generic handler.
          return new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          );
        }),
      ]);
    }
  }

  /**
   * Deletes a company and all associated resources.
   *
   * Removes the company record and relies on database cascade rules to clean up
   * related records such as memberships, notification settings, locations,
   * API keys, order, and trips. It also removes company storage files and
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

          // Cascade rules handle related records.
          await repo.remove(company);

          return userIds;
        },
      );

      // Storage cleanup – best effort is acceptable, but we want a safe
      // message if it fails rather than a stack trace.
      await this.storageService.deleteFolder(
        StoragePath.companyRoot(companyId),
      );

      // User cleanup – again, if one fails we want a descriptive but
      // non‑revealing error, not a raw HTTP error from Supabase.
      for (const userId of affectedUserIds) {
        await this.usersService.deleteSupabaseUser(userId);
      }
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.deleteCompany', [
        // 1. Data‑related errors during the transaction
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Could not complete the deletion due to a data conflict.',
            ),
        ),

        // 2. Storage cleanup failures – the company is already gone,
        //    but files may be orphaned.
        rule(Error, (e) => {
          if (
            e.message.includes('Storage') ||
            e.message.includes('folder') ||
            e.message.includes('file') ||
            e.message.includes('delete')
          ) {
            return new InternalErrorException(
              'Company removed, but some files could not be cleaned up immediately. Our team has been notified.',
            );
          }
          return new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          );
        }),

        // 3. Supabase user deletion errors – also a best‑effort step
        rule(Error, (e) => {
          if (
            e.message.includes('Supabase') ||
            e.message.includes('user') ||
            e.message.includes('delete') ||
            e.message.includes('account')
          ) {
            return new InternalErrorException(
              'Company removed, but user accounts may not have been fully deactivated. Our team has been notified.',
            );
          }
          return new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          );
        }),
      ]);
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

        // Explicit DTO – never exposes internal columns accidentally.
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
      this.errorHandler.handle(err, 'CompaniesService.createSavedLocation', [
        // 1. Unique constraint violation – most likely a duplicate label
        //    or another unique index on the SavedLocation table.
        rule(QueryFailedError, (e) => {
          const pg = (e as any).driverError;
          if (pg?.code === '23505') {
            return new ResourceConflictException(
              'A saved location with this label already exists. Please choose a different label.',
            );
          }
          // Any other query error (e.g., FK failure) stays generic.
          return new InternalErrorException(
            'Could not create the saved location due to a data error. Please try again.',
          );
        }),

        // 2. Catch‑all for any other runtime error.
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
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
        where: { companyId },
        order: { label: 'ASC' },
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
      this.errorHandler.handle(err, 'CompaniesService.listSavedLocations', [
        // Read‑only query failure – most likely a connection or
        // timeout. The client only needs to know that data couldn't
        // be fetched right now, not why.
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to retrieve saved locations at this time. Please try again.',
            ),
        ),
        // Catch‑all for anything else unexpected.
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
    }
  }

  async updateCompanyNotification(
    companyId: string,
    dto: UpdateCompanyNotificationDto,
  ) {
    try {
      return this.withTransaction(undefined, async (trx) => {
        const repo = trx.getRepository(CompanyNotificationSetting);

        const notificationSetting = await repo.findOne({
          where: { companyId },
        });

        if (!notificationSetting) {
          throw new ResourceNotFoundException(
            'Notification settings could not be found.',
          );
        }

        // Update the notification settings.
        await repo.update({ companyId }, dto);

        // Return the updated settings – selected fields only.
        return repo.findOne({
          where: { companyId },
          select: {
            customerEmailEnabled: true,
            teamEmailEnabled: true,
            customerEmailOrderCreated: true,
            customerEmailOrderAssigned: true,
            customerEmailOrderPickedUp: true,
            customerEmailOrderInTransit: true,
            customerEmailOrderDelivered: true,
            customerEmailOrderFailed: true,
          },
        });
      });
    } catch (err) {
      this.errorHandler.handle(
        err,
        'CompaniesService.updateCompanyNotification',
        [
          // 1. Database update failure – likely a type mismatch,
          //    missing column, or connection issue.
          rule(
            QueryFailedError,
            () =>
              new InternalErrorException(
                'Unable to update notification settings at this time. Please try again.',
              ),
          ),
          // 2. Catch‑all for any other unexpected runtime error.
          rule(
            Error,
            () =>
              new InternalErrorException(
                'An unexpected error occurred. Please try again later.',
              ),
          ),
        ],
      );
    }
  }

  async getCompanyNotification(companyId: string) {
    try {
      const notification = await this.companyNotificationRepo.findOne({
        where: { companyId },
      });

      if (!notification) {
        throw new ResourceNotFoundException(
          'No notifications found for this company.',
        );
      }

      // Hand‑pick the fields the client is allowed to see.
      return {
        customerEmailEnabled: notification.customerEmailEnabled,
        teamEmailEnabled: notification.teamEmailEnabled,
        customerEmailOrderCreated: notification.customerEmailOrderCreated,
        customerEmailOrderAssigned: notification.customerEmailOrderAssigned,
        customerEmailOrderPickedUp: notification.customerEmailOrderPickedUp,
        customerEmailOrderInTransit: notification.customerEmailOrderInTransit,
        customerEmailOrderDelivered: notification.customerEmailOrderDelivered,
        customerEmailOrderFailed: notification.customerEmailOrderFailed,
        customerEmailOrderCancelled: notification.customerEmailOrderCancelled,
      };
    } catch (err) {
      this.errorHandler.handle(err, 'CompaniesService.getCompanyNotification', [
        // Database read error – connection, timeout, etc.
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to retrieve notification settings at this time. Please try again.',
            ),
        ),
        // Any other unexpected runtime error.
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
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
      this.errorHandler.handle(err, 'CompaniesService.getSavedLocation', [
        // Database read error – connection, timeout, etc.
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to retrieve the saved location at this time. Please try again.',
            ),
        ),
        // Any other unexpected runtime error.
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
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
      this.errorHandler.handle(err, 'CompaniesService.updateSavedLocation', [
        // 1. Unique constraint violation – most likely a duplicate label
        //    for the same company.
        rule(QueryFailedError, (e) => {
          const pg = (e as any).driverError;
          if (pg?.code === '23505') {
            return new ResourceConflictException(
              'A saved location with this label already exists. Please choose a different label.',
            );
          }
          // Any other query error (e.g., FK failure, connection issue)
          // stays generic.
          return new InternalErrorException(
            'Unable to update the saved location due to a data error. Please try again.',
          );
        }),
        // 2. Catch‑all for any other unexpected runtime error.
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
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
      this.errorHandler.handle(err, 'CompaniesService.deleteSavedLocation', [
        // Database error during deletion – most likely a foreign‑key
        // constraint (location still referenced by orders) or a
        // connection problem.
        rule(
          QueryFailedError,
          () =>
            new InternalErrorException(
              'Unable to delete the saved location. It may be in use or temporarily unavailable.',
            ),
        ),
        // Any other unexpected runtime error.
        rule(
          Error,
          () =>
            new InternalErrorException(
              'An unexpected error occurred. Please try again later.',
            ),
        ),
      ]);
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
