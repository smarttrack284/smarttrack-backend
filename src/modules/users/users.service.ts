import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { UserRole } from "#/common/entities/user-role.entity";
import { TeamRoleType } from "#/common/types/team-role.type";
import {
  BadRequestAppException,
  UnauthorizedAppException,
    RateLimitedException,
    ExternalServiceException,
    ForbiddenAppException,
    InternalErrorException,
    ResourceConflictException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { SupabaseClient, User } from "@supabase/supabase-js";
import {
    SUPABASE_CLIENT,
    SUPABASE_PUBLIC
} from "#/common/constants/supabase.constant";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import { StorageService } from "#/common/storage/storage.service";
import { UpdateUserProfileDto } from "./dto/update-user-profile.dto";
import { StoragePath } from "#/common/storage/storage-path.util";
import { UpdatePasswordDto } from "#/modules/users/dto/update-password.dto";
import { ConfigService } from "@nestjs/config";
import { ErrorHandlerService } from "#/common/errors/error-handler.service";
import { randomUUID } from "crypto";

@Injectable()
export class UsersService {
    private readonly logger: Logger = new Logger(UsersService.name);
    constructor(
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        @InjectDataSource() private readonly dataSource: DataSource,
        @Inject(SUPABASE_CLIENT) private readonly supabaseAdmin: SupabaseClient,
        private readonly storageService: StorageService,
        private readonly config: ConfigService,
        private readonly errorHandler: ErrorHandlerService,
        @Inject(SUPABASE_PUBLIC)
        private readonly supabasePublic: SupabaseClient
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
        manager?: EntityManager
    ): Promise<UserRole> {
        return this.withTransaction(manager, async trx => {
            const repo = trx.getRepository(UserRole);

            const existing = await repo.findOne({
                where: {
                    userId: input.userId,
                    companyId: input.companyId
                }
            });

            if (existing) {
                throw new ResourceConflictException(
                    "This user is already a member of this company."
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
        manager?: EntityManager
    ): Promise<UserRole> {
        try {
            const repo = manager
                ? manager.getRepository(UserRole)
                : this.userRoleRepo;

            const userRole = await repo.findOne({
                where: { userId, companyId }
            });

            if (!userRole) {
                throw new ResourceNotFoundException(
                    "The user does not have access to this company."
                );
            }

            return userRole;
        } catch (err) {
            this.errorHandler.handle(err, "UsersService.getUserRole");
        }
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
        try {
            const { data, error } =
                await this.supabaseAdmin.auth.admin.getUserById(userId);

            if (error) {
                const msg = error.message?.toLowerCase() ?? "";
                const code = (error as any).code ?? "";

                // ── Rate limited by Supabase ──
                if (
                    code === "over_request_rate_limit" ||
                    code === "over_email_send_rate_limit" ||
                    msg.includes("rate limit") ||
                    msg.includes("too many requests")
                ) {
                    throw new RateLimitedException(
                        "Too many attempts. Please wait before trying again."
                    );
                }

                this.logger.error({
                    msg: "Failed to retrieve user from Supabase.",
                    err: (error as Error).message,
                    stack: (error as Error).stack
                });

                throw new InternalErrorException(
                    "We couldn’t retrieve your account at the moment. Please try again."
                );
            }

            if (!data?.user) {
                throw new ResourceNotFoundException(
                    "The requested user could not be found."
                );
            }

            return data.user;
        } catch (err) {
            this.errorHandler.handle(err, "UsersService.getUserFromSupabase");
        }
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
        manager?: EntityManager
    ): Promise<UserRole> {
        try {
            const repo = manager
                ? manager.getRepository(UserRole)
                : this.userRoleRepo;

            const userRole = await repo.findOne({
                where: { userId }
            });

            if (!userRole) {
                throw new ResourceNotFoundException(
                    "No role has been assigned to this user."
                );
            }

            return userRole;
        } catch (err) {
            this.errorHandler.handle(err, "UsersService.getUserRoleByUserId");
        }
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
        }
    ): Promise<{
        id: string;
        name: string | null;
        phone: string | null;
        avatarUrl: string | null;
    }> {
        let newUploadedAvatarPath: string | undefined;
        let oldAvatarPath: string | undefined;
        let avatarFilename: string | undefined;
        let avatarUrl: string | undefined;
        let previousMetadata: Record<string, unknown> = {};

        try {
            //  Resolve user and snapshot current metadata
            const supabaseUser = await this.getUserFromSupabase(userId);
            previousMetadata =
                (supabaseUser.user_metadata as Record<string, unknown>) ?? {};

            // Validate and upload avatar
            if (avatarFile) {
                const ext = avatarFile.extension
                    .toLowerCase()
                    .replace(/^\./, "");

                const existingFilename = previousMetadata.avatar_filename as
                    | string
                    | undefined;
                if (existingFilename) {
                    oldAvatarPath = StoragePath.userAvatar(
                        companyId,
                        userId,
                        existingFilename
                    );
                }

                avatarFilename = `avatar-${randomUUID()}.${ext}`;
                newUploadedAvatarPath = StoragePath.userAvatar(
                    companyId,
                    userId,
                    avatarFilename
                );

                avatarUrl = await this.storageService.uploadFile({
                    path: newUploadedAvatarPath,
                    buffer: avatarFile.buffer,
                    contentType: avatarFile.contentType
                });
            }

            //  Build metadata update
            const metadataUpdate: Record<string, unknown> = {};

            if (dto.name !== undefined) {
                metadataUpdate.full_name = dto.name.trim() || null;
            }
            if (dto.phone !== undefined) {
                metadataUpdate.phone = dto.phone.trim() || null;
            }
            if (avatarUrl) {
                metadataUpdate.avatar_url = avatarUrl;
                metadataUpdate.avatar_filename = avatarFilename;
            }

            let updatedUser = supabaseUser;
            let supabaseUpdated = false;

            // Update Supabase auth (source of truth)
            if (Object.keys(metadataUpdate).length > 0) {
                const { data, error } =
                    await this.supabaseAdmin.auth.admin.updateUserById(userId, {
                        user_metadata: metadataUpdate
                    });

                if (error || !data?.user) {
                    this.logger.error({
                        msg: "Supabase admin.updateUserById failed",
                        userId,
                        status: (error as any)?.status,
                        err: error?.message
                    });
                    throw new ExternalServiceException(
                        "We couldn't update your profile at the moment. Please try again."
                    );
                }

                updatedUser = data.user;
                supabaseUpdated = true;
            }

            // Sync local DB
            // If this fails, we must rollback Supabase metadata to keep stores
            // consistent. Auth metadata is the source of truth for reads.
            try {
                if (dto.name !== undefined) {
                    await this.userRoleRepo.update(
                        { userId },
                        { name: dto.name.trim() || null }
                    );
                }
                if (avatarUrl) {
                    await this.userRoleRepo.update({ userId }, { avatarUrl });
                }
            } catch (dbErr) {
                this.logger.error({
                    msg: "Local DB sync failed after Supabase profile update",
                    userId,
                    err: dbErr instanceof Error ? dbErr.message : String(dbErr)
                });

                // Best-effort rollback of Supabase metadata to previous state
                if (supabaseUpdated) {
                    await this.supabaseAdmin.auth.admin
                        .updateUserById(userId, {
                            user_metadata: previousMetadata
                        })
                        .catch(rollbackErr => {
                            this.logger.error({
                                msg: "CRITICAL: Supabase metadata rollback failed after DB error",
                                userId,
                                err:
                                    rollbackErr instanceof Error
                                        ? rollbackErr.message
                                        : String(rollbackErr)
                            });
                        });
                }

                throw new InternalErrorException(
                    "Unable to sync profile changes. Please try again."
                );
            }

            // Delete old avatar only after full success
            if (oldAvatarPath) {
                await this.storageService
                    .deleteFile(oldAvatarPath)
                    .catch(err => {
                        this.logger.error({
                            msg: "Failed deleting old avatar",
                            path: oldAvatarPath,
                            userId,
                            err:
                                err instanceof Error ? err.message : String(err)
                        });
                    });
            }

            const updatedMetadata = updatedUser.user_metadata as Record<
                string,
                unknown
            >;

            return {
                id: updatedUser.id,
                name: (updatedMetadata.full_name as string) ?? null,
                phone: (updatedMetadata.phone as string) ?? null,
                avatarUrl: (updatedMetadata.avatar_url as string) ?? null
            };
        } catch (err) {
            // Cleanup orphaned new avatar on any failure
            if (newUploadedAvatarPath) {
                await this.storageService
                    .deleteFile(newUploadedAvatarPath)
                    .catch(cleanupErr => {
                        this.logger.error({
                            msg: "Failed cleaning up uploaded avatar after error",
                            path: newUploadedAvatarPath,
                            userId,
                            err:
                                cleanupErr instanceof Error
                                    ? cleanupErr.message
                                    : String(cleanupErr)
                        });
                    });
            }
            this.errorHandler.handle(err, "UsersService.updateUserProfile");
        }
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
        dto: UpdatePasswordDto
    ): Promise<void> {
        try {
            // Verify current password
            // We MUST use the public/anon client here. The service-role client
            // bypasses password checks entirely.
            const { error: signInError } =
                await this.supabasePublic.auth.signInWithPassword({
                    email,
                    password: dto.currentPassword
                });

            if (signInError) {
                const msg = signInError.message?.toLowerCase() ?? "";

                if (
                    msg.includes("invalid login credentials") ||
                    msg.includes("invalid credentials")
                ) {
                    throw new UnauthorizedAppException(
                        "Your current password is incorrect."
                    );
                }

                this.logger.error({
                    msg: "Supabase public sign-in failed during password verification",
                    userId,
                    err: signInError.message
                });

                throw new ExternalServiceException(
                    "Unable to verify credentials. Please try again."
                );
            }

            //  Update password via admin
            const { error: updateError } =
                await this.supabaseAdmin.auth.admin.updateUserById(userId, {
                    password: dto.newPassword
                });

            if (updateError) {
                const msg = updateError.message?.toLowerCase() ?? "";

                this.logger.error({
                    msg: "Supabase admin.updateUserById failed during password change",
                    userId,
                    err: updateError.message
                });

                if (
                    msg.includes("password") ||
                    msg.includes("weak") ||
                    msg.includes("strength") ||
                    msg.includes("breached")
                ) {
                    throw new BadRequestAppException(
                        "New password does not meet security requirements. Please choose a stronger password."
                    );
                }

                throw new ExternalServiceException(
                    "We couldn't update your password. Please try again later."
                );
            }
        } catch (err) {
            this.errorHandler.handle(err, "UsersService.updatePassword");
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
        const { error } =
            await this.supabaseAdmin.auth.admin.deleteUser(userId);

        if (error) {
            this.logger.error(
                `Failed to delete user ${userId} from Supabase Auth.`,
                error
            );

            throw new ExternalServiceException(
                "We couldn't delete the user account at the moment. Please try again."
            );
        }
    }

    /**
     * Suspends a user in Supabase Auth, preventing them from logging in.
     *
     * @param userId - The unique identifier of the user to ban.
     * @param duration - The duration of the ban (defaults to '876000h', effectively a permanent ban).
     *
     * @throws {ExternalServiceException}
     * If the user account could not be suspended.
     */
    async banSupabaseUser(
        userId: string,
        duration: string = "876000h"
    ): Promise<void> {
        const { error } = await this.supabaseAdmin.auth.admin.updateUserById(
            userId,
            {
                ban_duration: duration
            }
        );

        if (error) {
            this.logger.error(
                `Failed to ban user ${userId} in Supabase Auth.`,
                error
            );

            throw new ExternalServiceException(
                "We couldn't suspend the user's login access at the moment. Please try again."
            );
        }
    }

    /**
     * Removes a suspension from a user in Supabase Auth, allowing them to log in again.
     *
     * @param userId - The unique identifier of the user to unban.
     *
     * @throws {ExternalServiceException}
     * If the user account could not be reactivated.
     */
    async unbanSupabaseUser(userId: string): Promise<void> {
        // Setting ban_duration to "none" unbans the user in Supabase
        const { error } = await this.supabaseAdmin.auth.admin.updateUserById(
            userId,
            {
                ban_duration: "none"
            }
        );

        if (error) {
            this.logger.error(
                `Failed to unban user ${userId} in Supabase Auth.`,
                error
            );

            throw new ExternalServiceException(
                "We couldn't restore the user's login access at the moment. Please try again."
            );
        }
    }

    /**
     * Same pattern as CompaniesService.withTransaction — participates in an
     * already-open transaction if `manager` is passed (e.g. from
     * CompaniesService.createCompany, so a company and its owner's role are
     * created atomically), otherwise owns its own QueryRunner lifecycle.
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
}
