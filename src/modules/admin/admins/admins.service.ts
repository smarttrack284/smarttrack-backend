import { Injectable, Logger, Inject } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
    Brackets,
    DataSource,
    EntityManager,
    IsNull,
    QueryFailedError,
    Repository,
    MoreThan
} from "typeorm";
import { AdminUser } from "#/common/entities/admin-user.entity";
import { AdminInvite } from "#/common/entities/admin-invite.entity";
import { UsersService } from "#/modules/users/users.service";
import { MailService } from "#/modules/mail/mail.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import {
    BadRequestAppException,
    InternalErrorException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { AdminAuditLogService } from "#/modules/admin/audit-log/audit-log.service";
import { AdminRole } from "#/common/constants/admin-role.constant";
import { MailTemplate } from "#/modules/mail/interfaces/mail-template.interface";
import { createHash, randomBytes } from "crypto";
import { ConfigService } from "@nestjs/config";
import { ListAdminsDto } from "./dto/list-admins.dto";
import { InviteAdminDto } from "./dto/invite-admin.dto";
import { AcceptAdminInviteDto } from "./dto/accept-admin-invite.dto";
import { UpdateAdminDto } from "./dto/update-admin.dto";
import { ResendAdminInviteDto } from "./dto/resend-admin-invite.dto";
import { ActivitySeverity } from "#/common/constants/activity-log.constant";
import { SUPABASE_CLIENT } from "#/common/constants/supabase.constant";
import { SupabaseClient } from "@supabase/supabase-js";
import { StorageService } from "#/common/storage/storage.service";
import { StoragePath } from "#/common/storage/storage-path.util";
import { randomUUID } from "crypto";
import { UpdateOwnProfileDto } from "./dto/update-own-profile.dto";
import {
    ListAdminInvitesDto,
    AdminInviteStatus
} from "./dto/list-admin-invites.dto";

@Injectable()
export class AdminAdminsService {
    private readonly logger = new Logger(AdminAdminsService.name);
    private readonly CACHE_TTL_SECONDS = 60;
    private readonly adminUrl: string;
    private readonly supportEmail: string;
    @Inject(SUPABASE_CLIENT) private readonly supabaseAdmin: SupabaseClient;

    constructor(
        @InjectRepository(AdminUser)
        private readonly adminUserRepo: Repository<AdminUser>,
        @InjectRepository(AdminInvite)
        private readonly adminInviteRepo: Repository<AdminInvite>,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly usersService: UsersService,
        private readonly mailService: MailService,
        private readonly cache: RedisCacheService,
        private readonly errorHandler: ErrorHandlerService,
        private readonly adminAuditLogService: AdminAuditLogService,
        private readonly config: ConfigService,
        private readonly storageService: StorageService
    ) {
        this.adminUrl =
            this.config.get<string>("ADMIN_URL") ??
            "https://admin.smarttrack.com";
        this.supportEmail =
            this.config.get<string>("SUPPORT_EMAIL") ?? "help@smarttrack.com";
    }

    // ========== Invite Management ==========

    async inviteAdmin(dto: InviteAdminDto, inviterUserId: string) {
        try {
            // Pre-check outside transaction (cheap, no write)
            const existing = await this.adminUserRepo.findOne({
                where: { email: dto.email }
            });
            if (existing) {
                throw new BadRequestAppException("User is already an admin");
            }

            const existingInvite = await this.adminInviteRepo.findOne({
                where: { email: dto.email, acceptedAt: IsNull() }
            });

            if (existingInvite && existingInvite.tokenExpiresAt > new Date()) {
                throw new BadRequestAppException(
                    "An active invite already exists for this email"
                );
            }

            // Generate token
            const plainToken = randomBytes(32).toString("hex");
            const tokenHash = createHash("sha256")
                .update(plainToken)
                .digest("hex");
            const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Insert invite atomically
            await this.withTransaction(undefined, async trx => {
                const inviteRepo = trx.getRepository(AdminInvite);
                const invite = inviteRepo.create({
                    email: dto.email,
                    role: dto.role,
                    tokenHash,
                    tokenExpiresAt
                });
                await inviteRepo.save(invite);
            });

            // After commit, send email and audit
            const inviteUrl = `${this.adminUrl}/admin/accept-invite?token=${plainToken}`;
            const roleLabel = this.formatRole(dto.role);

            await this.mailService.sendTemplateEmail({
                to: dto.email,
                subject: "You are invited to join SmartTrack admin team",
                templateName: MailTemplate.ADMIN_INVITE,
                context: {
                    inviteUrl,
                    roleLabel,
                    supportEmail: this.supportEmail,
                    year: new Date().getFullYear()
                }
            });

            await this.adminAuditLogService.record({
                adminUserId: inviterUserId,
                action: "admin.admin_invited",
                severity: ActivitySeverity.INFO,
                message: `Admin invited ${dto.email} as ${roleLabel}`,
                metadata: { email: dto.email, role: dto.role }
            });

            this.logger.log({ msg: "Sent admin invite", email: dto.email });

            return { success: true, email: dto.email };
        } catch (err) {
            this.errorHandler.handle(err, "AdminAdminsService.inviteAdmin", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to send admin invite. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async resendAdminInvite(dto: ResendAdminInviteDto, inviterUserId: string) {
        try {
            const invite = await this.adminInviteRepo.findOne({
                where: { email: dto.email, acceptedAt: IsNull() }
            });

            if (!invite) {
                throw new ResourceNotFoundException("No pending invite found");
            }

            // Generate new token
            const plainToken = randomBytes(32).toString("hex");
            const tokenHash = createHash("sha256")
                .update(plainToken)
                .digest("hex");
            const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await this.withTransaction(undefined, async trx => {
                const inviteRepo = trx.getRepository(AdminInvite);
                await inviteRepo.update(
                    { id: invite.id },
                    { tokenHash, tokenExpiresAt }
                );
            });

            const inviteUrl = `${this.adminUrl}/admin/accept-invite?token=${plainToken}`;
            const roleLabel = this.formatRole(invite.role);

            await this.mailService.sendTemplateEmail({
                to: invite.email,
                subject: "You are invited to join SmartTrack admin team",
                templateName: MailTemplate.ADMIN_INVITE,
                context: {
                    inviteUrl,
                    roleLabel,
                    supportEmail: this.supportEmail,
                    year: new Date().getFullYear()
                }
            });

            await this.adminAuditLogService.record({
                adminUserId: inviterUserId,
                action: "admin.admin_invite_resent",
                severity: ActivitySeverity.INFO,
                message: `Admin resent invite to ${dto.email}`,
                metadata: { email: dto.email, role: invite.role }
            });

            return { success: true, email: dto.email };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminAdminsService.resendAdminInvite",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to resend admin invite. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    async acceptAdminInvite(dto: AcceptAdminInviteDto) {
        try {
            const tokenHash = createHash("sha256")
                .update(dto.token)
                .digest("hex");
            const invite = await this.adminInviteRepo.findOne({
                where: { tokenHash }
            });

            if (
                !invite ||
                invite.acceptedAt ||
                invite.tokenExpiresAt < new Date()
            ) {
                throw new BadRequestAppException(
                    "Invite is invalid or expired"
                );
            }

            // Create Supabase user using admin client directly
            const { data, error } =
                await this.supabaseAdmin.auth.admin.createUser({
                    email: invite.email,
                    password: dto.password,
                    email_confirm: true,
                    user_metadata: { full_name: dto.fullName }
                });

            if (error || !data?.user) {
                throw new BadRequestAppException(
                    "Unable to create account. Please try again."
                );
            }

            let adminUserId: string;

            await this.withTransaction(undefined, async trx => {
                const adminUserRepo = trx.getRepository(AdminUser);
                const inviteRepo = trx.getRepository(AdminInvite);

                const adminUser = adminUserRepo.create({
                    userId: data.user.id,
                    email: invite.email,
                    name: dto.fullName,
                    role: invite.role,
                    isActive: true
                });
                const savedAdmin = await adminUserRepo.save(adminUser);
                adminUserId = savedAdmin.id;

                await inviteRepo.update(
                    { id: invite.id },
                    { acceptedAt: new Date() }
                );
            });

            // Invalidate caches
            await this.cache.del("admin:admins:list:*");
            await this.cache.del(`admin:user:${data.user.id}`);

            await this.adminAuditLogService.record({
                adminUserId: data.user.id,
                action: "admin.invite_accepted",
                severity: ActivitySeverity.INFO,
                message: `Admin ${invite.email} accepted invite and created account`
            });

            return { success: true };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminAdminsService.acceptAdminInvite",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to accept invite. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    async cancelAdminInvite(inviteId: string) {
        try {
            const invite = await this.adminInviteRepo.findOne({
                where: { id: inviteId }
            });

            if (!invite) {
                throw new ResourceNotFoundException("Invite not found");
            }

            if (invite.acceptedAt) {
                throw new BadRequestAppException(
                    "Cannot cancel an invite that has already been accepted"
                );
            }

            await this.withTransaction(undefined, async trx => {
                const inviteRepo = trx.getRepository(AdminInvite);
                await inviteRepo.delete({ id: inviteId });
            });

            // No list cache yet, but safe to invalidate if added later
            await this.cache.del("admin:admins:invites:*");

            await this.adminAuditLogService.record({
                adminUserId: null,
                action: "admin.admin_invite_cancelled",
                severity: ActivitySeverity.WARNING,
                message: `Admin cancelled invite for ${invite.email}`,
                metadata: { inviteId }
            });

            return { success: true, inviteId };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminAdminsService.cancelAdminInvite",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to cancel invite. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    // ========== Admin User Management ==========

    async listAdmins(dto: ListAdminsDto) {
        const cacheKey = `admin:admins:list:${this.buildListCacheKey(dto)}`;
        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryAdmins(dto)
            );
        } catch (err) {
            this.errorHandler.handle(err, "AdminAdminsService.listAdmins", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to list admins. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    private async queryAdmins(dto: ListAdminsDto) {
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;

        const qb = this.adminUserRepo
            .createQueryBuilder("admin")
            .addSelect([
                "admin.id",
                "admin.userId",
                "admin.name",
                "admin.email",
                "admin.role",
                "admin.isActive",
                "admin.createdAt"
            ]);

        if (dto.search) {
            qb.andWhere(
                new Brackets(sqb => {
                    sqb.where("admin.name ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("admin.email ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }
        if (dto.role) qb.andWhere("admin.role = :role", { role: dto.role });
        if (dto.isActive !== undefined)
            qb.andWhere("admin.isActive = :isActive", {
                isActive: dto.isActive
            });

        qb.orderBy("admin.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const admins = await qb.getMany();

        const countQb = this.adminUserRepo.createQueryBuilder("admin");
        if (dto.search) {
            countQb.andWhere(
                new Brackets(sqb => {
                    sqb.where("admin.name ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("admin.email ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }
        if (dto.role)
            countQb.andWhere("admin.role = :role", { role: dto.role });
        if (dto.isActive !== undefined)
            countQb.andWhere("admin.isActive = :isActive", {
                isActive: dto.isActive
            });
        const total = await countQb.getCount();

        return {
            admins: admins.map(a => ({
                id: a.id,
                userId: a.userId,
                name: a.name,
                email: a.email,
                role: a.role,
                isActive: a.isActive,
                createdAt: a.createdAt
            })),
            total,
            page,
            pageSize
        };
    }

    async getMe(userId: string) {
        const cacheKey = `admin:user:me:${userId}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                async () => {
                    const admin = await this.adminUserRepo.findOne({
                        where: { userId }
                    });

                    if (!admin) {
                        throw new ResourceNotFoundException("Admin not found");
                    }

                    let phone: string | null = null;
                    let avatarUrl: string | null = null;

                    try {
                        const { data: supabaseUser } =
                            await this.supabaseAdmin.auth.admin.getUserById(
                                userId
                            );

                        if (supabaseUser?.user) {
                            const metadata = supabaseUser.user
                                .user_metadata as Record<string, unknown>;
                            phone = (metadata.phone as string) ?? null;
                            avatarUrl = (metadata.avatar_url as string) ?? null;
                        }
                    } catch (supabaseErr) {
                        // Non‑critical – return what we have, log a warning
                        this.logger.warn({
                            msg: `Failed to fetch Supabase user for admin ${userId}`,
                            err:
                                supabaseErr instanceof Error
                                    ? supabaseErr.message
                                    : String(supabaseErr)
                        });
                    }

                    return {
                        id: admin.id,
                        userId: admin.userId,
                        name: admin.name,
                        email: admin.email,
                        role: admin.role,
                        phone,
                        avatarUrl,
                        isActive: admin.isActive,
                        createdAt: admin.createdAt
                    };
                }
            );
        } catch (err) {
            this.errorHandler.handle(err, "AdminAdminsService.getMe", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to load admin profile. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }
    async updateAdmin(adminId: string, dto: UpdateAdminDto) {
        try {
            await this.withTransaction(undefined, async trx => {
                const adminRepo = trx.getRepository(AdminUser);
                const admin = await adminRepo.findOne({
                    where: { id: adminId }
                });
                if (!admin)
                    throw new ResourceNotFoundException("Admin not found");

                if (dto.role !== undefined) admin.role = dto.role;
                if (dto.isActive !== undefined) admin.isActive = dto.isActive;
                await adminRepo.save(admin);
            });

            const admin = await this.adminUserRepo.findOne({
                where: { id: adminId }
            });
            if (!admin) throw new ResourceNotFoundException("Admin not found");

            await this.cache.del(`admin:user:${admin.userId}`);
            await this.cache.del("admin:admins:list:*");

            await this.adminAuditLogService.record({
                adminUserId: null,
                action: "admin.admin_updated",
                severity: ActivitySeverity.WARNING,
                message: `Admin ${admin.email} updated`,
                metadata: {
                    adminId,
                    role: admin.role,
                    isActive: admin.isActive
                }
            });

            return { success: true, adminId };
        } catch (err) {
            this.errorHandler.handle(err, "AdminAdminsService.updateAdmin", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to update admin. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async suspendAdmin(adminId: string) {
        try {
            const admin = await this.adminUserRepo.findOne({
                where: { id: adminId }
            });
            if (!admin) throw new ResourceNotFoundException("Admin not found");

            // Ban in Supabase to revoke sessions and prevent login
            await this.usersService.banSupabaseUser(admin.userId);

            // Soft deactivate in database
            await this.withTransaction(undefined, async trx => {
                const adminRepo = trx.getRepository(AdminUser);
                await adminRepo.update({ id: adminId }, { isActive: false });
            });

            await this.cache.del(`admin:user:${admin.userId}`);
            await this.cache.del("admin:admins:list:*");

            await this.adminAuditLogService.record({
                adminUserId: null,
                action: "admin.admin_suspended",
                severity: ActivitySeverity.WARNING,
                message: `Admin ${admin.email} suspended`,
                metadata: { adminId }
            });

            return { success: true, adminId };
        } catch (err) {
            this.errorHandler.handle(err, "AdminAdminsService.suspendAdmin", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to suspend admin. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }

    async reactivateAdmin(adminId: string) {
        try {
            const admin = await this.adminUserRepo.findOne({
                where: { id: adminId }
            });
            if (!admin) throw new ResourceNotFoundException("Admin not found");

            // Unban in Supabase
            await this.usersService.unbanSupabaseUser(admin.userId);

            // Set active in database
            await this.withTransaction(undefined, async trx => {
                const adminRepo = trx.getRepository(AdminUser);
                await adminRepo.update({ id: adminId }, { isActive: true });
            });

            await this.cache.del(`admin:user:${admin.userId}`);
            await this.cache.del("admin:admins:list:*");

            await this.adminAuditLogService.record({
                adminUserId: null,
                action: "admin.admin_reactivated",
                severity: ActivitySeverity.INFO,
                message: `Admin ${admin.email} reactivated`,
                metadata: { adminId }
            });

            return { success: true, adminId };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminAdminsService.reactivateAdmin",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to reactivate admin. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    async removeAdmin(adminId: string) {
        try {
            const admin = await this.adminUserRepo.findOne({
                where: { id: adminId }
            });
            if (!admin) throw new ResourceNotFoundException("Admin not found");

            // Retrieve avatar filename from Supabase metadata before deletion
            let avatarFilename: string | undefined;
            try {
                const { data: supabaseUser } =
                    await this.supabaseAdmin.auth.admin.getUserById(
                        admin.userId
                    );
                if (supabaseUser?.user) {
                    const metadata = supabaseUser.user.user_metadata as Record<
                        string,
                        unknown
                    >;
                    avatarFilename = metadata.avatar_filename as
                        | string
                        | undefined;
                }
            } catch (err) {
                // Non‑critical: we can still delete without the filename
                this.logger.warn({
                    msg: `Failed to fetch Supabase user for avatar cleanup ${admin.userId}`,
                    err: err instanceof Error ? err.message : String(err)
                });
            }

            // Delete Supabase user completely
            const { error: deleteError } =
                await this.supabaseAdmin.auth.admin.deleteUser(admin.userId);
            if (deleteError) {
                throw new BadRequestAppException(
                    "Unable to delete user from authentication system."
                );
            }

            // Delete AdminUser record
            await this.withTransaction(undefined, async trx => {
                const adminRepo = trx.getRepository(AdminUser);
                await adminRepo.delete({ id: adminId });
            });

            // Delete avatar file (best effort, after successful deletion)
            if (avatarFilename) {
                const avatarPath = StoragePath.adminAvatar(
                    admin.userId,
                    avatarFilename
                );
                await this.storageService.deleteFile(avatarPath).catch(err => {
                    this.logger.error({
                        msg: `Failed to delete admin avatar for ${admin.userId}`,
                        path: avatarPath,
                        err: err instanceof Error ? err.message : String(err)
                    });
                });
            }

            await this.cache.del(`admin:user:${admin.userId}`);
            await this.cache.del("admin:admins:list:*");

            await this.adminAuditLogService.record({
                adminUserId: null,
                action: "admin.admin_removed",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin ${admin.email} permanently removed`,
                metadata: { adminId }
            });

            return { success: true, adminId };
        } catch (err) {
            this.errorHandler.handle(err, "AdminAdminsService.removeAdmin", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to remove admin. Please try again."
                        )
                ),
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "An unexpected error occurred. Please try again later."
                        )
                )
            ]);
        }
    }
    async updateOwnProfile(
        adminUserId: string,
        dto: UpdateOwnProfileDto,
        avatarFile?: { buffer: Buffer; contentType: string; extension: string }
    ) {
        let newUploadedAvatarPath: string | undefined;
        let oldAvatarPath: string | undefined;
        let avatarFilename: string | undefined;
        let avatarUrl: string | undefined;
        let previousMetadata: Record<string, unknown> = {};

        try {
            // Get current admin user
            const admin = await this.adminUserRepo.findOne({
                where: { userId: adminUserId }
            });
            if (!admin) {
                throw new ResourceNotFoundException("Admin not found");
            }

            // Get current Supabase user and metadata
            const supabaseUser =
                await this.supabaseAdmin.auth.admin.getUserById(adminUserId);
            if (!supabaseUser.data.user) {
                throw new ResourceNotFoundException("Supabase user not found");
            }
            previousMetadata =
                (supabaseUser.data.user.user_metadata as Record<
                    string,
                    unknown
                >) ?? {};

            // Handle avatar upload
            if (avatarFile) {
                const ext = avatarFile.extension
                    .toLowerCase()
                    .replace(/^\./, "");
                const existingFilename = previousMetadata.avatar_filename as
                    | string
                    | undefined;
                if (existingFilename) {
                    oldAvatarPath = StoragePath.adminAvatar(
                        adminUserId,
                        existingFilename
                    );
                }

                avatarFilename = `avatar-${randomUUID()}.${ext}`;
                newUploadedAvatarPath = StoragePath.adminAvatar(
                    adminUserId,
                    avatarFilename
                );
                avatarUrl = await this.storageService.uploadFile({
                    path: newUploadedAvatarPath,
                    buffer: avatarFile.buffer,
                    contentType: avatarFile.contentType
                });
            }

            // Build metadata update
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

            let supabaseUpdated = false;
            if (Object.keys(metadataUpdate).length > 0) {
                const { error } =
                    await this.supabaseAdmin.auth.admin.updateUserById(
                        adminUserId,
                        { user_metadata: metadataUpdate }
                    );
                if (error) {
                    throw new InternalErrorException(
                        "Failed to update Supabase profile"
                    );
                }
                supabaseUpdated = true;
            }

            // Sync local DB (AdminUser.name) – with rollback if fails
            try {
                if (dto.name !== undefined) {
                    await this.adminUserRepo.update(
                        { id: admin.id },
                        { name: dto.name.trim() || admin.name }
                    );
                }
            } catch (dbErr) {
                this.logger.error({
                    msg: "Local DB sync failed after Supabase admin profile update",
                    adminUserId,
                    err: dbErr instanceof Error ? dbErr.message : String(dbErr)
                });

                // Rollback Supabase metadata
                if (supabaseUpdated) {
                    await this.supabaseAdmin.auth.admin
                        .updateUserById(adminUserId, {
                            user_metadata: previousMetadata
                        })
                        .catch(rollbackErr => {
                            this.logger.error({
                                msg: "CRITICAL: Supabase metadata rollback failed after DB error",
                                adminUserId,
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

            // Delete old avatar after full success
            if (oldAvatarPath) {
                await this.storageService
                    .deleteFile(oldAvatarPath)
                    .catch(err => {
                        this.logger.error({
                            msg: "Failed deleting old admin avatar",
                            path: oldAvatarPath,
                            adminUserId,
                            err:
                                err instanceof Error ? err.message : String(err)
                        });
                    });
            }

            // Invalidate cache
            await this.cache.del(`admin:user:${adminUserId}`);

            // Audit log
            await this.adminAuditLogService.record({
                adminUserId,
                action: "admin.profile_updated",
                severity: ActivitySeverity.INFO,
                message: `Admin ${admin.email} updated their profile`,
                metadata: {
                    adminUserId,
                    updatedFields: Object.keys(metadataUpdate)
                }
            });

            // Return updated profile (from fresh Supabase data)
            const updatedUser =
                await this.supabaseAdmin.auth.admin.getUserById(adminUserId);
            const updatedMetadata = updatedUser.data.user?.user_metadata ?? {};
            return {
                id: admin.id,
                userId: adminUserId,
                name: (updatedMetadata.full_name as string) ?? admin.name,
                phone: (updatedMetadata.phone as string) ?? null,
                avatarUrl: (updatedMetadata.avatar_url as string) ?? null,
                role: admin.role,
                isActive: admin.isActive,
                email: admin.email,
                createdAt: admin.createdAt
            };
        } catch (err) {
            // Cleanup new avatar on failure
            if (newUploadedAvatarPath) {
                await this.storageService
                    .deleteFile(newUploadedAvatarPath)
                    .catch(cleanupErr => {
                        this.logger.error({
                            msg: "Failed cleaning up uploaded admin avatar after error",
                            path: newUploadedAvatarPath,
                            adminUserId,
                            err:
                                cleanupErr instanceof Error
                                    ? cleanupErr.message
                                    : String(cleanupErr)
                        });
                    });
            }
            this.errorHandler.handle(
                err,
                "AdminAdminsService.updateOwnProfile"
            );
        }
    }
    async listAdminInvites(dto: ListAdminInvitesDto) {
        const cacheKey = `admin:admins:invites:${this.buildInvitesCacheKey(
            dto
        )}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryAdminInvites(dto)
            );
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminAdminsService.listAdminInvites",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to list admin invites. Please try again."
                            )
                    ),
                    rule(
                        Error,
                        () =>
                            new InternalErrorException(
                                "An unexpected error occurred. Please try again later."
                            )
                    )
                ]
            );
        }
    }

    private async queryAdminInvites(dto: ListAdminInvitesDto) {
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;
        const now = new Date();

        const qb = this.adminInviteRepo
            .createQueryBuilder("invite")
            .addSelect([
                "invite.id",
                "invite.email",
                "invite.role",
                "invite.acceptedAt",
                "invite.tokenExpiresAt",
                "invite.createdAt"
            ]);

        // Status filter
        switch (dto.status) {
            case AdminInviteStatus.PENDING:
                qb.where("invite.acceptedAt IS NULL").andWhere(
                    "invite.tokenExpiresAt > :now",
                    { now }
                );
                break;
            case AdminInviteStatus.ACCEPTED:
                qb.where("invite.acceptedAt IS NOT NULL");
                break;
            default:
                // 'all' – no additional filter
                break;
        }

        if (dto.search) {
            qb.andWhere("invite.email ILIKE :search", {
                search: `%${dto.search}%`
            });
        }

        qb.orderBy("invite.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const invites = await qb.getMany();

        // Count total
        const countQb = this.adminInviteRepo.createQueryBuilder("invite");

        switch (dto.status) {
            case AdminInviteStatus.PENDING:
                countQb
                    .where("invite.acceptedAt IS NULL")
                    .andWhere("invite.tokenExpiresAt > :now", { now });
                break;
            case AdminInviteStatus.ACCEPTED:
                countQb.where("invite.acceptedAt IS NOT NULL");
                break;
            default:
                break;
        }

        if (dto.search) {
            countQb.andWhere("invite.email ILIKE :search", {
                search: `%${dto.search}%`
            });
        }

        const total = await countQb.getCount();

        const mappedInvites = invites.map(invite => ({
            id: invite.id,
            email: invite.email,
            role: invite.role,
            status: invite.acceptedAt ? "accepted" : "pending",
            tokenExpiresAt: invite.tokenExpiresAt,
            acceptedAt: invite.acceptedAt,
            createdAt: invite.createdAt
        }));

        return {
            invites: mappedInvites,
            total,
            page,
            pageSize
        };
    }

    private buildInvitesCacheKey(dto: ListAdminInvitesDto): string {
        const parts = [
            dto.status ?? AdminInviteStatus.PENDING,
            dto.search ?? "",
            dto.page ?? 1,
            dto.pageSize ?? 20
        ];
        return parts.join("|");
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

    private formatRole(role: AdminRole): string {
        switch (role) {
            case AdminRole.SUPER_ADMIN:
                return "Super Admin";
            case AdminRole.SUPPORT:
                return "Support";
            case AdminRole.MANAGER:
                return "Manager";
            default:
                return role;
        }
    }

    private buildListCacheKey(dto: ListAdminsDto): string {
        return [
            dto.search ?? "",
            dto.role ?? "",
            dto.isActive !== undefined ? String(dto.isActive) : "",
            dto.page ?? 1,
            dto.pageSize ?? 20
        ].join("|");
    }
}
