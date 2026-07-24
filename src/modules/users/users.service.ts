import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { TeamRoleType } from '#/common/types/team-role.type';
import {
  ExternalServiceException,
  ForbiddenAppException,
  InternalErrorException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '#/common/constants/supabase.constant';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import { StorageService } from '#/common/storage/storage.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { StoragePath } from '#/common/storage/storage-path.util';
import { UpdatePasswordDto } from '#/modules/users/dto/update-password.dto';
import { ConfigService } from '@nestjs/config';
import { NotificationSetting } from '#/common/entities/notification-setting.entity';
import { UpdateNotificationSettingsDto } from '#/modules/users/dto/update-notification-settings.dto';

@Injectable()
export class UsersService {
  private readonly logger: Logger = new Logger(UsersService.name);
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(NotificationSetting)
    private readonly notificationSettingRepository: Repository<NotificationSetting>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a user role assignment for a company.
   *
   * Assigns a user to a company with the specified role and membership status.
   *
   * @param input - The user role information to create.
   * @param manager - Optional transaction entity manager.
   * @returns The newly created user role.
   *
   * @throws {ResourceConflictException}
   * If the user already has a role assigned within the company.
   */
  async createUserRole(
    input: {
      userId: string;
      companyId: string;
      name: string;
      email: string;
      status: TeamMemberStatus;
      invitedAt?: Date | null;
      joinedAt?: Date | null;
      role: TeamRoleType;
    },
    manager?: EntityManager,
  ): Promise<UserRole> {
    return this.withTransaction(manager, async (trx) => {
      const repo = trx.getRepository(UserRole);

      const existing = await repo.findOne({
        where: {
          userId: input.userId,
          companyId: input.companyId,
        },
      });

      if (existing) {
        throw new ResourceConflictException(
          'This user is already a member of this company.',
        );
      }

      const userRole = repo.create(input);

      return await repo.save(userRole);
    });
  }

  /**
   * Retrieves a user's role within a company.
   *
   * @param userId - The user's unique identifier.
   * @param companyId - The company's unique identifier.
   * @param manager - Optional transaction entity manager.
   * @returns The user's role for the specified company.
   *
   * @throws {ResourceNotFoundException}
   * If the user does not have a role in the specified company.
   */
  async getUserRole(
    userId: string,
    companyId: string,
    manager?: EntityManager,
  ): Promise<UserRole> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;

    const userRole = await repo.findOne({
      where: { userId, companyId },
    });

    if (!userRole) {
      throw new ResourceNotFoundException(
        'The user does not have access to this company.',
      );
    }

    return userRole;
  }

  /**
   * Retrieves a user from Supabase Auth.
   *
   * @param userId - The unique identifier of the user.
   * @returns The authenticated user.
   *
   * @throws {ResourceNotFoundException}
   * If the user could not be found.
   */
  async getUserFromSupabase(userId: string): Promise<User> {
    const { data, error } = await this.supabase.auth.admin.getUserById(userId);

    if (error) {
      // Log the technical error for developers
      this.logger.error('Failed to retrieve user from Supabase.', error);

      throw new InternalErrorException(
        'We couldn’t retrieve your account at the moment. Please try again.',
      );
    }

    if (!data?.user) {
      throw new ResourceNotFoundException(
        'The requested user could not be found.',
      );
    }

    return data.user;
  }

  /**
   * Retrieves the role assigned to a user.
   *
   * @param userId - The user's unique identifier.
   * @param manager - Optional transaction entity manager.
   * @returns The user's assigned role.
   *
   * @throws {ResourceNotFoundException}
   * If the user does not have an assigned role.
   */
  async getUserRoleByUserId(
    userId: string,
    manager?: EntityManager,
  ): Promise<UserRole> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;

    const userRole = await repo.findOne({
      where: { userId },
    });

    if (!userRole) {
      throw new ResourceNotFoundException(
        'No role has been assigned to this user.',
      );
    }

    return userRole;
  }

  /**
   * Updates a user's profile information.
   *
   * Updates profile metadata in Supabase, uploads a new avatar when provided,
   * stores avatar information including the file extension, and synchronizes
   * the user's display name with the company membership record.
   *
   * @param userId - The unique identifier of the user.
   * @param companyId - The unique identifier of the company.
   * @param dto - Profile fields to update.
   * @param avatarFile - Optional avatar file upload information.
   *
   * @returns The updated profile information.
   */
  async updateUserProfile(
    userId: string,
    companyId: string,
    dto: UpdateUserProfileDto,
    avatarFile?: {
      buffer: Buffer;
      contentType: string;
      extension: string;
    },
  ): Promise<{
    id: string;
    name: string | null;
    phone: string | null;
    avatarUrl: string | null;
  }> {
    let avatarUrl: string | undefined;
    let avatarExtension: string | undefined;

    const supabaseUser = await this.getUserFromSupabase(userId);

    if (avatarFile) {
      const metadata = supabaseUser.user_metadata as
        Record<string, unknown> | undefined;

      const existingAvatarExtension = metadata?.avatar_extension as
        string | undefined;

      const existingAvatarUrl = metadata?.avatar_url as string | undefined;

      if (existingAvatarUrl && existingAvatarExtension) {
        await this.storageService.deleteFile(
          StoragePath.userAvatar(
            companyId,
            userId,
            `avatar.${existingAvatarExtension}`,
          ),
        );
      }

      const extension = avatarFile.extension.toLowerCase();

      const path = StoragePath.userAvatar(
        companyId,
        userId,
        `avatar.${extension}`,
      );

      avatarUrl = await this.storageService.uploadFile({
        path,
        buffer: avatarFile.buffer,
        contentType: avatarFile.contentType,
      });

      avatarExtension = extension;
    }

    const metadataUpdate: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      metadataUpdate.full_name = dto.name;
    }

    if (dto.phone !== undefined) {
      metadataUpdate.phone = dto.phone;
    }

    if (avatarUrl !== undefined) {
      metadataUpdate.avatar_url = avatarUrl;
    }

    if (avatarExtension !== undefined) {
      metadataUpdate.avatar_extension = avatarExtension;
    }

    let updatedUser = supabaseUser;

    if (Object.keys(metadataUpdate).length > 0) {
      const { data, error } = await this.supabase.auth.admin.updateUserById(
        userId,
        {
          user_metadata: metadataUpdate,
        },
      );

      if (error || !data?.user) {
        this.logger.error(
          `Failed to update profile for user ${userId}.`,
          error,
        );

        throw new ExternalServiceException(
          'Profile',
          "We couldn't update your profile at the moment. Please try again.",
        );
      }

      updatedUser = data.user;
    }

    if (dto.name !== undefined) {
      await this.userRoleRepo.update({ userId }, { name: dto.name });
    }

    const metadata = updatedUser.user_metadata as Record<
      string,
      unknown
    > | null;

    return {
      id: updatedUser.id,
      name: (metadata?.full_name as string | undefined) ?? null,
      phone: (metadata?.phone as string | undefined) ?? null,
      avatarUrl: (metadata?.avatar_url as string | undefined) ?? null,
    };
  }

  /**
   * Updates a user's password.
   *
   * Verifies the user's current password before updating it to a new password
   * in Supabase Auth.
   *
   * @param userId - The unique identifier of the user.
   * @param email - The user's email address.
   * @param dto - The password update request.
   *
   * @throws {ForbiddenAppException}
   * If the current password provided is incorrect.
   *
   * @throws {ExternalServiceException}
   * If the password could not be updated.
   */
  async updatePassword(
    userId: string,
    email: string,
    dto: UpdatePasswordDto,
  ): Promise<void> {
    const { createClient } = await import('@supabase/supabase-js');

    const verifyClient = createClient(
      this.config.get<string>('SUPABASE_URL')!,
      this.config.get<string>('SUPABASE_PUBLISHABLE_KEY')!,
    );

    const { error: signInError } = await verifyClient.auth.signInWithPassword({
      email,
      password: dto.currentPassword,
    });

    if (signInError) {
      throw new ForbiddenAppException('Your current password is incorrect.');
    }

    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      password: dto.newPassword,
    });

    if (error) {
      this.logger.error(`Failed to update password for user ${userId}.`, error);

      throw new ExternalServiceException(
        'Password',
        "We couldn't update your password at the moment. Please try again.",
      );
    }
  }

  /**
   * Permanently deletes a user from Supabase Auth.
   *
   * @param userId - The unique identifier of the user to delete.
   *
   * @throws {ExternalServiceException}
   * If the user account could not be deleted.
   */
  async deleteSupabaseUser(userId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(userId);

    if (error) {
      this.logger.error(
        `Failed to delete user ${userId} from Supabase Auth.`,
        error,
      );

      throw new ExternalServiceException(
        'User account',
        "We couldn't delete the user account at the moment. Please try again.",
      );
    }
  }

  /**
   * Retrieves a user's notification settings.
   *
   * @param userId - The unique identifier of the user.
   * @returns The user's notification settings.
   *
   * @throws {ResourceNotFoundException}
   * If the user's notification settings could not be found.
   */
  async getNotificationSettings(
    userId: string,
  ): Promise<{
    emailOrderCreated: boolean;
    emailOrderAssigned: boolean;
    emailOrderPickedUp: boolean;
    emailOrderDelivered: boolean;
    emailOrderFailed: boolean;
    emailOrderCancelled: boolean;
  }> {
    const notificationSetting =
      await this.notificationSettingRepository.findOne({
        where: { userId },
        select: {
          emailOrderCreated: true,
          emailOrderAssigned: true,
          emailOrderPickedUp: true,
          emailOrderDelivered: true,
          emailOrderFailed: true,
          emailOrderCancelled: true,
        },
      });

    if (!notificationSetting) {
      throw new ResourceNotFoundException(
        'Notification settings could not be found.',
      );
    }

    return notificationSetting;
  }

  /**
   * Updates a user's notification settings.
   *
   * @param userId - The unique identifier of the user.
   * @param dto - The notification settings to update.
   * @returns The updated notification settings.
   *
   * @throws {ResourceNotFoundException}
   * If the user's notification settings could not be found.
   */
  async updateNotificationSettings(
    userId: string,
    dto: UpdateNotificationSettingsDto,
  ) {
    return this.withTransaction(undefined, async (trx) => {
      const repo = trx.getRepository(NotificationSetting);

      const notificationSetting = await repo.findOne({
        where: { userId },
      });

      if (!notificationSetting) {
        throw new ResourceNotFoundException(
          'Notification settings could not be found.',
        );
      }

      // Update the notification settings.
      await repo.update({ userId }, dto);

      // Return the updated notification settings.
      return repo.findOne({
        where: { userId },
        select: {
          emailOrderCreated: true,
          emailOrderAssigned: true,
          emailOrderPickedUp: true,
          emailOrderDelivered: true,
          emailOrderCancelled: true,
          emailOrderFailed: true,
        },
      });
    });
  }

  /**
   * Same pattern as CompaniesService.withTransaction — participates in an
   * already-open transaction if `manager` is passed (e.g. from
   * CompaniesService.createCompany, so a company and its owner's role are
   * created atomically), otherwise owns its own QueryRunner lifecycle.
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
}
