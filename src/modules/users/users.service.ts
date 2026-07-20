import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { TeamRoleType } from '#/common/types/team-role.type';
import {
  ExternalServiceException,
  ForbiddenAppException,
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
   * Creates a role assignment linking a user to a company. Used both
   * standalone (inviting/promoting a team member) and as a step inside
   * another service's transaction — most importantly,
   * CompaniesService.createCompany should call this with its own `manager`
   * to atomically create the company AND its first owner's role in one
   * transaction, so a company can never exist with zero owners.
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
        where: { userId: input.userId, companyId: input.companyId },
      });
      if (existing) {
        throw new ResourceConflictException(
          'This user already has a role in this company',
        );
      }

      const userRole = repo.create(input);
      return await repo.save(userRole);
    });
  }

  async getUserRole(
    userId: string,
    companyId: string,
    manager?: EntityManager,
  ): Promise<UserRole> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const userRole = await repo.findOne({ where: { userId, companyId } });
    if (!userRole) {
      throw new ResourceNotFoundException('UserRole');
    }
    return userRole;
  }

  /**
   * Looks up a user directly from Supabase Auth by their user ID, using
   * the Admin API — this is NOT the same as reading your own `user_roles`
   * table. Use this when you need Supabase's own record of a user (email,
   * email_confirmed_at, user_metadata like full_name, etc.), e.g. to pull
   * `ownerName` for CompaniesService.createCompany once a real auth guard
   * exists and only has a userId to work with.
   *
   * Requires the service-role Supabase client (SUPABASE_CLIENT) — never
   * expose this method's result wholesale to a client response, since the
   * Supabase User object can include fields you may not want to leak
   * (identity provider details, etc.). Map to only what you need at the
   * call site.
   */
  async getUserFromSupabase(userId: string): Promise<User> {
    const { data, error } = await this.supabase.auth.admin.getUserById(userId);

    if (error || !data?.user) {
      throw new ResourceNotFoundException('User', userId);
    }

    return data.user;
  }

  /**
   * Finds a user's role WITHOUT already knowing their companyId — the entry
   * point for "which company does this authenticated user belong to,"
   * needed by OrdersService (and any future module) to scope operations to
   * the caller's own company rather than trusting a companyId from the
   * request. Assumes one company per user for this MVP; if multi-company
   * membership is ever needed, this needs to return a list instead.
   */
  async getUserRoleByUserId(
    userId: string,
    manager?: EntityManager,
  ): Promise<UserRole> {
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const userRole = await repo.findOne({ where: { userId } });
    if (!userRole) {
      throw new ResourceNotFoundException('UserRole');
    }
    return userRole;
  }

  /**
   * Updates a user's profile — name/avatar update BOTH Supabase Auth
   * (user_metadata, so it's the source of truth wherever else this app or
   * Supabase itself reads it from) AND every UserRole row for this user
   * (since `name` is deliberately duplicated onto UserRole for fast team-
   * list reads without joining out to Supabase — see TeamService).
   *
   * Avatar upload follows the exact same StorageService/StoragePath
   * convention as the company logo, just under a user-scoped path.
   */
  async updateUserProfile(
    userId: string,
    companyId: string,
    dto: UpdateUserProfileDto,
    avatarFile?: { buffer: Buffer; contentType: string; extension: string },
  ): Promise<{
    id: string;
    // email: string;
    name: string | null;
    avatarUrl: string | null;
  }> {
    let avatarUrl: string | undefined;

    if (avatarFile) {
      const path = StoragePath.userAvatar(
        companyId,
        userId,
        `avatar.${avatarFile.extension}`,
      );
      avatarUrl = await this.storageService.uploadFile({
        path,
        buffer: avatarFile.buffer,
        contentType: avatarFile.contentType,
      });
    }

    const metadataUpdate: Record<string, unknown> = {};
    if (dto.name !== undefined) metadataUpdate.full_name = dto.name;
    if (avatarUrl !== undefined) metadataUpdate.avatar_url = avatarUrl;

    const updatePayload: {
      user_metadata?: Record<string, unknown>;
      // email?: string;
    } = {};
    if (Object.keys(metadataUpdate).length > 0)
      updatePayload.user_metadata = metadataUpdate;

    // Email changes go through Supabase's own confirm-new-address flow —
    // the auth record's email does NOT change until that link is clicked.
    // Passing it here just triggers that flow; UserRole.email is
    // deliberately left untouched until acceptPendingInvite-style
    // confirmation, matching Supabase's own "not yet applied" state.
    // Silently updating UserRole.email immediately would let the app show
    // an email nobody's actually confirmed owning yet.
    // if (dto.email !== undefined) updatePayload.email = dto.email;

    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await this.supabase.auth.admin.updateUserById(
        userId,
        updatePayload,
      );
      if (error || !data?.user) {
        throw new ExternalServiceException('Supabase Auth', error?.message);
      }
    }

    if (dto.name !== undefined) {
      await this.userRoleRepo.update({ userId }, { name: dto.name });
    }

    const refreshed = await this.getUserFromSupabase(userId);
    return {
      id: refreshed.id,
      // email: refreshed.email ?? '',
      name:
        ((refreshed.user_metadata as Record<string, unknown> | null)
          ?.full_name as string | undefined) ?? null,
      avatarUrl:
        ((refreshed.user_metadata as Record<string, unknown> | null)
          ?.avatar_url as string | undefined) ?? null,
    };
  }

  /**
   * Password changes go through Supabase's own reauthentication —
   * verified by attempting a real sign-in with the CURRENT password
   * first, using a throwaway client instance (never the admin client,
   * which has no concept of "does this password match" — that's a
   * publishable-key operation, not a service-role one). Only on success
   * does it call the admin API to set the new one. This is what makes
   * "current password" a real check, not just a UI-level formality.
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
      throw new ForbiddenAppException('Your current password is incorrect');
    }

    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      password: dto.newPassword,
    });
    if (error) {
      throw new ExternalServiceException('Supabase Auth', error.message);
    }
  }

  /** Deletes the Supabase account outright — ONLY call this after confirming hasNoRemainingCompanyMemberships, never as a direct consequence of one company's deletion alone. */
  async deleteSupabaseUser(userId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(userId);
    if (error) {
      throw new ExternalServiceException('Supabase Auth', error.message);
    }
  }

  async getNotificationSettings(userId: string): Promise<NotificationSetting> {
    const notificationSetting =
      await this.notificationSettingRepository.findOne({
        where: { userId },
      });
    if (!notificationSetting) {
      throw new ResourceNotFoundException('No notification setting');
    }
    return notificationSetting;
  }

  async updateNotificationSettings(
    userId: string,
    dto: UpdateNotificationSettingsDto,
  ) {
    return this.withTransaction(undefined, async (trx) => {
      const repo = trx.getRepository(NotificationSetting);
      const notificationSetting = await repo.findOne({ where: { userId } });

      if (!notificationSetting) {
        throw new ResourceNotFoundException('Notification Settings');
      }

      // Update the record with the new dto values
      await repo.update({ userId }, dto);

      // Fetch and return the updated notification setting
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
