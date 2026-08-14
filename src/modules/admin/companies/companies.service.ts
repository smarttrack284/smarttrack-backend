import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
    Brackets,
    DataSource,
    EntityManager,
    In,
    QueryFailedError,
    Repository
} from "typeorm";
import { Company } from "#/common/entities/company.entity";
import { Subscription } from "#/common/entities/subscription.entity";
import { Usage } from "#/common/entities/usage.entity";
import { Order } from "#/common/entities/order.entity";
import { UserRole } from "#/common/entities/user-role.entity";
import { ApiKey } from "#/common/entities/api-key.entity";
import { WebhookEndpoint } from "#/common/entities/webhook-endpoint.entity";
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
import { CompanySort, ListCompaniesDto } from "./dto/list-companies.dto";
import { GetCompanyDetailDto } from "./dto/get-company-detail.dto";
import { TeamRoleType } from "#/common/types/team-role.type";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import {
    getPlanUsageLimits,
    SubscriptionPlan,
    SubscriptionStatus
} from "#/common/constants/subscription-plan.constant";
import { ActivityLogService } from "#/modules/activity-log/activity-log.service";
import { UpdateCompanyPlanDto } from "#/modules/admin/companies/dto/update-company-plan.dto";
import { PlanGuard } from "#/common/guards/plan.guard";
import {
    ActivityCategory,
    ActivitySeverity
} from "#/common/constants/activity-log.constant";
import { SendPasswordResetDto } from "#/modules/admin/companies/dto/send-password-reset.dto";
import { AdminUsersService } from "#/modules/admin/users/users.service";
import {
    ListCompanyOrdersDto,
    OrderSort
} from "#/modules/admin/companies/dto/list-company-orders.dto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { RevokeApiKeyDto } from "#/modules/admin/companies/dto/revoke-api-key.dto";
import { UsersService } from "#/modules/users/users.service";
import { WebhookDelivery } from "#/common/entities/webhook-delivery.entity";
import { ListWebhookDeliveriesAdminDto } from "#/modules/admin/companies/dto/list-webhook-deliveries-admin.dto";
import { ToggleWebhookEndpointDto } from "#/modules/admin/companies/dto/toggle-webhook-endpoint.dto";
import { ChangeOwnerDto } from "#/modules/admin/companies/dto/change-owner.dto";
import { AdminAuditLog } from "#/common/entities/admin-audit-log.entity";
import { OrderItem } from "#/common/entities/order-item.entity";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { Trip } from "#/common/entities/trip.entity";
import { SavedLocation } from "#/common/entities/saved-location.entity";
import { CompanyNotificationSetting } from "#/common/entities/company-notification-settings.entity";
import { ActivityLog } from "#/common/entities/activity-log.entity";
import { StoragePath } from "#/common/storage/storage-path.util";
import { StorageService } from "#/common/storage/storage.service";
import { ListApiKeysDto, ApiKeyStatusFilter } from "./dto/list-api-keys.dto";
import { ListWebhookEndpointsDto } from "./dto/list-webhook-endpoints.dto";

interface CompanyRow {
    company_id: string;
    company_name: string;
    company_email: string;
    company_logo_url: string | null;
    company_timezone: string;
    company_created_at: Date;
    plan: string | null;
    subscription_status: string | null;
    current_period_end: Date | null;
    owner_name: string | null;
    owner_email: string | null;
    total_orders: string;
    total_drivers: string;
    total_team_members: string;
}

@Injectable()
export class AdminCompaniesService {
    private readonly logger = new Logger(AdminCompaniesService.name);
    private readonly CACHE_TTL_SECONDS = 60;

    constructor(
        @InjectRepository(Company)
        private readonly companyRepo: Repository<Company>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectRepository(Usage)
        private readonly usageRepo: Repository<Usage>,
        @InjectRepository(Order)
        private readonly orderRepo: Repository<Order>,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
        @InjectRepository(ApiKey)
        private readonly apiKeyRepo: Repository<ApiKey>,
        @InjectRepository(WebhookEndpoint)
        private readonly webhookRepo: Repository<WebhookEndpoint>,
        private readonly cache: RedisCacheService,
        private readonly errorHandler: ErrorHandlerService,
        private readonly activityLogService: ActivityLogService,
        private readonly adminUsersService: AdminUsersService,
        private readonly usersService: UsersService,
        @InjectDataSource()
        private readonly dataSource: DataSource,
        private readonly events: EventEmitter2,
        @InjectRepository(WebhookDelivery)
        private readonly webhookDeliveryRepo: Repository<WebhookDelivery>,
        @InjectRepository(AdminAuditLog)
        private readonly adminAuditLogRepo: Repository<AdminAuditLog>,
        private readonly storageService: StorageService
    ) {}

    async listCompanies(dto: ListCompaniesDto) {
        const cacheKey = this.buildCacheKey(dto);

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryCompanies(dto)
            );
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.listCompanies",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to list companies. Please try again."
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

    async getCompanyDetail(companyId: string, dto: GetCompanyDetailDto) {
        const cacheKey = `admin:companies:detail:${companyId}:${dto.teamPage}:${dto.teamPageSize}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.buildCompanyDetail(companyId, dto)
            );
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.getCompanyDetail",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to load company details. Please try again."
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

    async changeCompanyPlan(
        companyId: string,
        adminUserId: string,
        dto: UpdateCompanyPlanDto
    ) {
        try {
            const result = await this.withTransaction(undefined, async trx => {
                const companyRepo = trx.getRepository(Company);
                const subscriptionRepo = trx.getRepository(Subscription);

                const company = await companyRepo.findOne({
                    where: { id: companyId }
                });
                if (!company) {
                    throw new ResourceNotFoundException("Company not found");
                }

                const subscription = await subscriptionRepo.findOne({
                    where: { companyId }
                });
                if (!subscription) {
                    throw new ResourceNotFoundException(
                        "Subscription not found for this company"
                    );
                }

                subscription.plan = dto.plan;
                if (dto.plan === SubscriptionPlan.FREE) {
                    subscription.status = SubscriptionStatus.CANCELED;
                } else {
                    subscription.status = SubscriptionStatus.ACTIVE;
                }

                await subscriptionRepo.save(subscription);

                return {
                    success: true,
                    companyId,
                    plan: dto.plan,
                    status: subscription.status
                };
            });

            // Invalidate PlanGuard cache (after successful commit)
            await this.cache.del(PlanGuard.subscriptionKey(companyId));

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            // Audit log
            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.plan_changed",
                severity: ActivitySeverity.WARNING,
                message: `Admin changed company plan to ${dto.plan}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.plan_changed",
                severity: ActivitySeverity.WARNING,
                message: `Admin changed company plan to ${dto.plan}`
            });

            this.logger.log({
                msg: "Changed company plan",
                companyId,
                plan: dto.plan
            });

            return result;
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.changeCompanyPlan",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to change plan. Please try again."
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

    async sendPasswordReset(
        companyId: string,
        adminUserId: string,
        dto: SendPasswordResetDto
    ) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            const membership = await this.userRoleRepo.findOne({
                where: { companyId, userId: dto.userId }
            });
            if (!membership) {
                throw new BadRequestAppException(
                    "User is not a member of this company"
                );
            }

            const email = membership.email;
            await this.adminUsersService.sendPasswordResetEmail(email);

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            // Audit log
            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.password_reset_sent",
                severity: ActivitySeverity.WARNING,
                message: `Admin sent password reset to user ${dto.userId}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.password_reset_sent",
                severity: ActivitySeverity.WARNING,
                message: `Admin sent password reset to user ${dto.userId}`
            });

            this.logger.log({
                msg: "Sent password reset email",
                companyId,
                userId: dto.userId,
                email
            });

            return {
                success: true,
                email
            };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.sendPasswordReset",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to send password reset. Please try again."
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

    async listCompanyOrders(companyId: string, dto: ListCompanyOrdersDto) {
        const cacheKey = `admin:companies:${companyId}:orders:${this.buildOrdersCacheKey(
            dto
        )}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryCompanyOrders(companyId, dto)
            );
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.listCompanyOrders",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to list orders. Please try again."
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

    async revokeApiKey(
        companyId: string,
        adminUserId: string,
        dto: RevokeApiKeyDto
    ) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            const apiKey = await this.apiKeyRepo.findOne({
                where: { id: dto.apiKeyId, companyId }
            });
            if (!apiKey) {
                throw new ResourceNotFoundException("API key not found");
            }

            if (apiKey.revokedAt) {
                // Already revoked – idempotent success
                return {
                    success: true,
                    apiKeyId: apiKey.id,
                    revokedAt: apiKey.revokedAt
                };
            }

            const revokedAt = new Date();

            await this.withTransaction(undefined, async trx => {
                const apiKeyRepo = trx.getRepository(ApiKey);
                await apiKeyRepo.update({ id: apiKey.id }, { revokedAt });
            });

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            // Audit log for admin action
            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.api_key_revoked",
                severity: ActivitySeverity.WARNING,
                message: `Admin revoked API key "${apiKey.name}"`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.api_key_revoked",
                severity: ActivitySeverity.WARNING,
                message: `Admin revoked API key "${apiKey.name}`
            });

            this.logger.log({
                msg: "Revoked API key",
                companyId,
                apiKeyId: apiKey.id
            });

            return {
                success: true,
                apiKeyId: apiKey.id,
                revokedAt
            };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.revokeApiKey",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to revoke API key. Please try again."
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

    async suspendCompany(companyId: string, adminUserId: string) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            const memberships = await this.userRoleRepo.find({
                where: { companyId },
                select: { userId: true }
            });
            const userIds = memberships
                .map(m => m.userId)
                .filter((id): id is string => !!id);

            //  Update DB atomically
            await this.withTransaction(undefined, async trx => {
                const userRoleRepo = trx.getRepository(UserRole);
                const subscriptionRepo = trx.getRepository(Subscription);

                await userRoleRepo.update(
                    { companyId },
                    { status: TeamMemberStatus.SUSPENDED }
                );
                await subscriptionRepo.update(
                    { companyId },
                    { status: SubscriptionStatus.CANCELED }
                );
            });

            //  Ban users in Supabase (best effort)
            for (const userId of userIds) {
                try {
                    await this.usersService.banSupabaseUser(userId);
                } catch (banErr) {
                    this.logger.error({
                        msg: `Failed to ban user ${userId}`,
                        err: (banErr as Error).message
                    });
                }
            }

            //  Invalidate caches
            await this.cache.del(`plan-guard:subscription:${companyId}`);
            for (const userId of userIds) {
                await this.cache.del(`user:company:${userId}`);
            }

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            //  Audit log
            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.company_suspended",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin suspended company ${company.name}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.company_suspended",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin suspended company ${company.name}`
            });

            this.logger.log({
                msg: "Suspended company",
                companyId,
                usersAffected: userIds.length
            });

            return { success: true, companyId, state: "suspended" };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.suspendCompany",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to suspend company. Please try again."
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

    async reactivateCompany(companyId: string, adminUserId: string) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            const memberships = await this.userRoleRepo.find({
                where: { companyId },
                select: { userId: true }
            });
            const userIds = memberships
                .map(m => m.userId)
                .filter((id): id is string => !!id);

            //  Update DB atomically
            await this.withTransaction(undefined, async trx => {
                const userRoleRepo = trx.getRepository(UserRole);
                const subscriptionRepo = trx.getRepository(Subscription);

                await userRoleRepo.update(
                    { companyId },
                    { status: TeamMemberStatus.ACTIVE }
                );
                await subscriptionRepo.update(
                    { companyId },
                    { status: SubscriptionStatus.ACTIVE }
                );
            });

            // Unban users in Supabase (best effort)
            for (const userId of userIds) {
                try {
                    await this.usersService.unbanSupabaseUser(userId);
                } catch (unbanErr) {
                    this.logger.error({
                        msg: `Failed to unban user ${userId}`,
                        err: (unbanErr as Error).message
                    });
                }
            }

            //  Invalidate caches
            await this.cache.del(`plan-guard:subscription:${companyId}`);
            for (const userId of userIds) {
                await this.cache.del(`user:company:${userId}`);
            }

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            //  Audit log
            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.company_reactivated",
                severity: ActivitySeverity.WARNING,
                message: `Admin reactivated company ${company.name}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata?.full_name
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.company_reactivated",
                severity: ActivitySeverity.WARNING,
                message: `Admin reactivated company ${company.name}`
            });

            this.logger.log({
                msg: "Reactivated company",
                companyId,
                usersAffected: userIds.length
            });

            return { success: true, companyId, state: "active" };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.reactivateCompany",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to reactivate company. Please try again."
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

    async listWebhookDeliveries(
        companyId: string,
        dto: ListWebhookDeliveriesAdminDto
    ) {
        const cacheKey = `admin:companies:${companyId}:webhook-deliveries:${this.buildWebhookDeliveriesCacheKey(
            dto
        )}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryWebhookDeliveries(companyId, dto)
            );
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.listWebhookDeliveries",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to list webhook deliveries. Please try again."
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

    async toggleWebhookEndpoint(
        companyId: string,
        adminUserId: string,
        endpointId: string,
        dto: ToggleWebhookEndpointDto
    ) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            const endpoint = await this.webhookRepo.findOne({
                where: { id: endpointId, companyId }
            });
            if (!endpoint) {
                throw new ResourceNotFoundException(
                    "Webhook endpoint not found"
                );
            }

            const newIsActive =
                dto.isActive !== undefined ? dto.isActive : !endpoint.isActive;
            const oldIsActive = endpoint.isActive;

            await this.withTransaction(undefined, async trx => {
                const webhookRepo = trx.getRepository(WebhookEndpoint);
                await webhookRepo.update(
                    { id: endpointId },
                    { isActive: newIsActive }
                );
            });

            // Invalidate detail cache for this company (if detail endpoint caches webhooks)
            await this.cache.del(`admin:companies:detail:${companyId}:*`); // NOTE: wildcard not supported by default. We'll just log and skip, or use del with exact key pattern if we used consistent detail keys. For simplicity, we can ignore cache invalidation here; the detail endpoint has 60s TTL anyway.

            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.webhook_toggled",
                severity: ActivitySeverity.WARNING,
                message: `Admin ${
                    newIsActive ? "enabled" : "disabled"
                } webhook endpoint ${endpoint.description || endpoint.id}`,
                actorUserId: null,
                actorName: null,
                metadata: { endpointId, oldIsActive, newIsActive }
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.webhook_toggled",
                severity: "warning",
                message: `Admin ${
                    newIsActive ? "enabled" : "disabled"
                } webhook endpoint ${endpoint.description || endpoint.id}`,
                metadata: { endpointId, oldIsActive, newIsActive }
            });

            this.logger.log({
                msg: "Toggled webhook endpoint",
                companyId,
                endpointId,
                oldIsActive,
                newIsActive
            });

            return {
                success: true,
                companyId,
                endpointId,
                isActive: newIsActive
            };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.toggleWebhookEndpoint",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to toggle webhook endpoint. Please try again."
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

    async changeOwner(
        companyId: string,
        adminUserId: string,
        dto: ChangeOwnerDto
    ) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            const currentOwner = await this.userRoleRepo.findOne({
                where: { companyId, role: TeamRoleType.OWNER }
            });
            if (!currentOwner) {
                throw new ResourceNotFoundException("Company has no owner");
            }

            const newOwner = await this.userRoleRepo.findOne({
                where: { companyId, userId: dto.newOwnerUserId }
            });
            if (!newOwner) {
                throw new BadRequestAppException(
                    "Target user is not a member of this company"
                );
            }

            if (newOwner.status !== TeamMemberStatus.ACTIVE) {
                throw new BadRequestAppException(
                    "Target user is not active and cannot become owner"
                );
            }

            if (currentOwner.userId === dto.newOwnerUserId) {
                // already owner
                return {
                    success: true,
                    companyId,
                    previousOwnerUserId: currentOwner.userId,
                    newOwnerUserId: dto.newOwnerUserId
                };
            }

            await this.withTransaction(undefined, async trx => {
                const userRoleRepo = trx.getRepository(UserRole);

                // Demote current owner to admin
                await userRoleRepo.update(
                    { id: currentOwner.id },
                    { role: TeamRoleType.ADMIN }
                );

                // Promote new owner
                await userRoleRepo.update(
                    { id: newOwner.id },
                    { role: TeamRoleType.OWNER }
                );
            });

            // Invalidate caches
            if (currentOwner.userId) {
                await this.cache.del(`user:company:${currentOwner.userId}`);
            }
            await this.cache.del(`user:company:${dto.newOwnerUserId}`);

            const adminUser =
                await this.usersService.getUserFromSupabase(adminUserId);

            // Audit log
            await this.activityLogService.record({
                companyId,
                category: ActivityCategory.ADMIN_ACTION,
                eventType: "admin.ownership_changed",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin changed company owner from ${currentOwner.userId} to ${dto.newOwnerUserId}`,
                actorUserId: adminUserId,
                actorName: adminUser.user_metadata.full_name,
                metadata: {
                    previousOwnerUserId: currentOwner.userId,
                    newOwnerUserId: dto.newOwnerUserId
                }
            });

            // Admin Audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.ownership_changed",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin changed company owner from ${currentOwner.userId} to ${dto.newOwnerUserId}`,
                metadata: {
                    previousOwnerUserId: currentOwner.userId,
                    newOwnerUserId: dto.newOwnerUserId
                }
            });

            this.logger.log({
                msg: "Changed company owner",
                companyId,
                previousOwnerUserId: currentOwner.userId,
                newOwnerUserId: dto.newOwnerUserId
            });

            return {
                success: true,
                companyId,
                previousOwnerUserId: currentOwner.userId,
                newOwnerUserId: dto.newOwnerUserId
            };
        } catch (err) {
            this.errorHandler.handle(err, "AdminCompaniesService.changeOwner", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to change company owner. Please try again."
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

    async deleteCompany(companyId: string, adminUserId: string) {
        try {
            const company = await this.companyRepo.findOne({
                where: { id: companyId }
            });
            if (!company) {
                throw new ResourceNotFoundException("Company not found");
            }

            // Fetch all user IDs for Supabase deletion and cache invalidation
            const memberships = await this.userRoleRepo.find({
                where: { companyId },
                select: { userId: true }
            });
            const userIds = memberships
                .map(m => m.userId)
                .filter((id): id is string => !!id);

            // Transaction: delete all DB records in safe order
            await this.withTransaction(undefined, async trx => {
                const orderRepo = trx.getRepository(Order);
                const orderItemRepo = trx.getRepository(OrderItem);
                const tripStopRepo = trx.getRepository(TripStop);
                const tripRepo = trx.getRepository(Trip);
                const savedLocationRepo = trx.getRepository(SavedLocation);
                const notificationSettingRepo = trx.getRepository(
                    CompanyNotificationSetting
                );
                const usageRepo = trx.getRepository(Usage);
                const userRoleRepo = trx.getRepository(UserRole);
                const subscriptionRepo = trx.getRepository(Subscription);
                const apiKeyRepo = trx.getRepository(ApiKey);
                const webhookEndpointRepo = trx.getRepository(WebhookEndpoint);
                const webhookDeliveryRepo = trx.getRepository(WebhookDelivery);
                const activityLogRepo = trx.getRepository(ActivityLog);
                const companyRepo = trx.getRepository(Company);

                // Delete in foreign-key-safe order
                await webhookDeliveryRepo.delete({
                    webhookEndpoint: { companyId }
                }); // or using query
                await webhookEndpointRepo.delete({ companyId });
                await apiKeyRepo.delete({ companyId });
                await activityLogRepo.delete({ companyId });

                // Orders & items
                const orders = await orderRepo.find({ where: { companyId } });
                const orderIds = orders.map(o => o.id);
                if (orderIds.length) {
                    await orderItemRepo.delete({ orderId: In(orderIds) });
                    await orderRepo.delete(orderIds);
                }

                // Trips & stops
                const trips = await tripRepo.find({ where: { companyId } });
                const tripIds = trips.map(t => t.id);
                if (tripIds.length) {
                    await tripStopRepo.delete({ tripId: In(tripIds) });
                    await tripRepo.delete(tripIds);
                }

                await savedLocationRepo.delete({ companyId });
                await notificationSettingRepo.delete({ companyId });
                await usageRepo.delete({ companyId });
                await userRoleRepo.delete({ companyId });
                await subscriptionRepo.delete({ companyId });
                await companyRepo.delete({ id: companyId });
            });

            // Post‑transaction best effort: delete Supabase users
            for (const userId of userIds) {
                try {
                    await this.usersService.deleteSupabaseUser(userId);
                } catch (err) {
                    this.logger.error({
                        msg: `Failed to delete Supabase user ${userId}`,
                        err: (err as Error).message
                    });
                }
            }

            // Best effort: delete company storage folder
            try {
                await this.storageService.deleteFolder(
                    StoragePath.companyRoot(companyId)
                );
            } catch (err) {
                this.logger.error({
                    msg: `Failed to delete company storage for ${companyId}`,
                    err: (err as Error).message
                });
            }

            // Invalidate caches (exact keys we know)
            await this.cache.del(`plan-guard:subscription:${companyId}`);
            for (const userId of userIds) {
                await this.cache.del(`user:company:${userId}`);
            }
            // optionally: admin list cache invalidation if we have a pattern; skip for MVP

            // Write admin audit log
            await this.adminAuditLogRepo.save({
                adminUserId,
                companyId,
                action: "admin.company_deleted",
                severity: ActivitySeverity.CRITICAL,
                message: `Admin deleted company ${company.name}`,
                metadata: {
                    companyName: company.name,
                    usersDeleted: userIds.length
                }
            });

            this.logger.log({
                msg: "Deleted company",
                companyId,
                companyName: company.name,
                usersDeleted: userIds.length
            });

            return {
                success: true,
                companyId,
                deletedAt: new Date()
            };
        } catch (err) {
            this.errorHandler.handle(
                err,
                "AdminCompaniesService.deleteCompany",
                [
                    rule(
                        QueryFailedError,
                        () =>
                            new InternalErrorException(
                                "Unable to delete company. Please try again."
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
async listWebhookEndpoints(
  companyId: string,
  dto: ListWebhookEndpointsDto,
) {
  const cacheKey = `admin:companies:${companyId}:webhook-endpoints:${this.buildWebhookEndpointsCacheKey(dto)}`;

  try {
    return await this.cache.getOrSet(cacheKey, this.CACHE_TTL_SECONDS, () =>
      this.queryWebhookEndpoints(companyId, dto),
    );
  } catch (err) {
    this.errorHandler.handle(
      err,
      'AdminCompaniesService.listWebhookEndpoints',
      [
        rule(QueryFailedError, () =>
          new InternalErrorException(
            'Unable to list webhook endpoints. Please try again.',
          ),
        ),
        rule(Error, () =>
          new InternalErrorException(
            'An unexpected error occurred. Please try again later.',
          ),
        ),
      ],
    );
  }
}

private async queryWebhookEndpoints(
  companyId: string,
  dto: ListWebhookEndpointsDto,
) {
  const company = await this.companyRepo.findOne({ where: { id: companyId } });
  if (!company) {
    throw new ResourceNotFoundException('Company not found');
  }

  const page = dto.page ?? 1;
  const pageSize = dto.pageSize ?? 20;

  const qb = this.webhookRepo
    .createQueryBuilder('endpoint')
    .select([
      'endpoint.id',
      'endpoint.description',
      'endpoint.url',
      'endpoint.events',
      'endpoint.isActive',
      'endpoint.createdAt',
      'endpoint.updatedAt',
    ])
    .where('endpoint.companyId = :companyId', { companyId });

  // Search filter
  if (dto.search) {
    qb.andWhere(
      new Brackets((sqb) => {
        sqb
          .where('endpoint.description ILIKE :search', {
            search: `%${dto.search}%`,
          })
          .orWhere('endpoint.url ILIKE :search', {
            search: `%${dto.search}%`,
          });
      }),
    );
  }

  // Active filter
  if (dto.isActive !== undefined) {
    qb.andWhere('endpoint.isActive = :isActive', {
      isActive: dto.isActive,
    });
  }

  qb.orderBy('endpoint.createdAt', 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize);

  const webhookEndpoints = await qb.getMany();

  // Count total
  const countQb = this.webhookRepo
    .createQueryBuilder('endpoint')
    .where('endpoint.companyId = :companyId', { companyId });

  if (dto.search) {
    countQb.andWhere(
      new Brackets((sqb) => {
        sqb
          .where('endpoint.description ILIKE :search', {
            search: `%${dto.search}%`,
          })
          .orWhere('endpoint.url ILIKE :search', {
            search: `%${dto.search}%`,
          });
      }),
    );
  }

  if (dto.isActive !== undefined) {
    countQb.andWhere('endpoint.isActive = :isActive', {
      isActive: dto.isActive,
    });
  }

  const total = await countQb.getCount();

  return {
    company: {
      id: company.id,
      name: company.name,
    },
    webhookEndpoints,
    total,
    page,
    pageSize,
  };
}

private buildWebhookEndpointsCacheKey(
  dto: ListWebhookEndpointsDto,
): string {
  const parts = [
    dto.search ?? '',
    dto.isActive !== undefined ? String(dto.isActive) : '',
    dto.page ?? 1,
    dto.pageSize ?? 20,
  ];
  return parts.join('|');
}

    private async queryWebhookDeliveries(
        companyId: string,
        dto: ListWebhookDeliveriesAdminDto
    ) {
        const company = await this.companyRepo.findOne({
            where: { id: companyId }
        });
        if (!company) {
            throw new ResourceNotFoundException("Company not found");
        }

        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;

        const qb = this.webhookDeliveryRepo
            .createQueryBuilder("delivery")
            .innerJoin("delivery.webhookEndpoint", "endpoint")
            .leftJoin(Company, "company", "company.id = endpoint.companyId")
            .select([
                "delivery.id",
                "delivery.webhookEndpointId",
                "delivery.eventId",
                "delivery.eventType",
                "delivery.status",
                "delivery.attemptNumber",
                "delivery.httpStatusCode",
                "delivery.errorMessage",
                "delivery.createdAt",
                "delivery.deliveredAt"
            ])
            .addSelect("company.id", "companyId")
            .addSelect("company.name", "companyName")
            .where("endpoint.companyId = :companyId", { companyId });

        if (dto.webhookEndpointId) {
            qb.andWhere("endpoint.id = :webhookEndpointId", {
                webhookEndpointId: dto.webhookEndpointId
            });
        }

        if (dto.status) {
            qb.andWhere("delivery.status = :status", { status: dto.status });
        }

        qb.orderBy("delivery.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const rawRows = await qb.getRawMany<{
            delivery_id: string;
            delivery_webhookEndpointId: string;
            delivery_eventId: string;
            delivery_eventType: string;
            delivery_status: string;
            delivery_attemptNumber: number;
            delivery_httpStatusCode: number | null;
            delivery_errorMessage: string | null;
            delivery_createdAt: Date;
            delivery_deliveredAt: Date | null;
            companyId: string;
            companyName: string;
        }>();

        // Count total
        const countQb = this.webhookDeliveryRepo
            .createQueryBuilder("delivery")
            .innerJoin("delivery.webhookEndpoint", "endpoint")
            .where("endpoint.companyId = :companyId", { companyId });

        if (dto.webhookEndpointId) {
            countQb.andWhere("endpoint.id = :webhookEndpointId", {
                webhookEndpointId: dto.webhookEndpointId
            });
        }
        if (dto.status) {
            countQb.andWhere("delivery.status = :status", {
                status: dto.status
            });
        }

        const total = await countQb.getCount();

        const deliveries = rawRows.map(row => ({
            id: row.delivery_id,
            webhookEndpointId: row.delivery_webhookEndpointId,
            eventId: row.delivery_eventId,
            eventType: row.delivery_eventType,
            status: row.delivery_status,
            attemptNumber: row.delivery_attemptNumber,
            httpStatusCode: row.delivery_httpStatusCode,
            errorMessage: row.delivery_errorMessage ?? null,
            createdAt: row.delivery_createdAt,
            deliveredAt: row.delivery_deliveredAt,
            companyId: row.companyId,
            companyName: row.companyName ?? "Unknown"
        }));

        const response = {
            company: {
                id: company.id,
                name: company.name
            },
            deliveries,
            total,
            page,
            pageSize
        };

        return response;
    }

    private buildWebhookDeliveriesCacheKey(
        dto: ListWebhookDeliveriesAdminDto
    ): string {
        const parts = [
            dto.webhookEndpointId ?? "",
            dto.status ?? "",
            dto.page ?? 1,
            dto.pageSize ?? 20
        ];
        return parts.join("|");
    }

    private buildOrdersCacheKey(dto: ListCompanyOrdersDto): string {
        const parts = [
            dto.search ?? "",
            dto.status ?? "",
            dto.dateFrom ?? "",
            dto.dateTo ?? "",
            dto.sort ?? OrderSort.NEWEST,
            dto.page ?? 1,
            dto.pageSize ?? 20
        ];
        return parts.join("|");
    }

    private async queryCompanyOrders(
        companyId: string,
        dto: ListCompanyOrdersDto
    ) {
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;

        const qb = this.orderRepo
            .createQueryBuilder("order")
            .select([
                "order.id",
                "order.trackingNumber",
                "order.orderReference",
                "order.customerName",
                "order.customerPhone",
                "order.customerEmail",
                "order.pickupLocation",
                "order.dropoffLocation",
                "order.status",
                "order.priority",
                "order.createdAt"
            ])
            .addSelect(
                subQuery =>
                    subQuery
                        .select("COUNT(*)", "totalItems")
                        .from("order_items", "oi")
                        .where("oi.orderId = order.id"),
                "totalItems"
            )
            .where("order.companyId = :companyId", { companyId });

        // Filters
        if (dto.search) {
            qb.andWhere(
                new Brackets(sqb => {
                    sqb.where("order.trackingNumber ILIKE :search", {
                        search: `%${dto.search}%`
                    })
                        .orWhere("order.orderReference ILIKE :search", {
                            search: `%${dto.search}%`
                        })
                        .orWhere("order.customerName ILIKE :search", {
                            search: `%${dto.search}%`
                        });
                })
            );
        }

        if (dto.status) {
            qb.andWhere("order.status = :status", { status: dto.status });
        }

        if (dto.dateFrom) {
            qb.andWhere("order.createdAt >= :dateFrom", {
                dateFrom: new Date(dto.dateFrom)
            });
        }

        if (dto.dateTo) {
            const endOfDay = new Date(dto.dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            qb.andWhere("order.createdAt <= :dateTo", { dateTo: endOfDay });
        }

        // Sorting
        qb.orderBy(
            "order.createdAt",
            dto.sort === OrderSort.OLDEST ? "ASC" : "DESC"
        );

        qb.skip((page - 1) * pageSize).take(pageSize);

        const rawRows = await qb.getRawMany<{
            order_id: string;
            order_trackingNumber: string;
            order_orderReference: string;
            order_customerName: string;
            order_customerPhone: string;
            order_customerEmail: string | null;
            order_pickupLocation: string;
            order_dropoffLocation: string;
            order_status: string;
            order_priority: string;
            order_createdAt: Date;
            totalItems: string;
        }>();

        // Count total (separate count query with same filters)
        const countQb = this.orderRepo
            .createQueryBuilder("order")
            .where("order.companyId = :companyId", { companyId });

        if (dto.search) {
            countQb.andWhere(
                new Brackets(sqb => {
                    sqb.where("order.trackingNumber ILIKE :search", {
                        search: `%${dto.search}%`
                    })
                        .orWhere("order.orderReference ILIKE :search", {
                            search: `%${dto.search}%`
                        })
                        .orWhere("order.customerName ILIKE :search", {
                            search: `%${dto.search}%`
                        });
                })
            );
        }
        if (dto.status) {
            countQb.andWhere("order.status = :status", { status: dto.status });
        }
        if (dto.dateFrom) {
            countQb.andWhere("order.createdAt >= :dateFrom", {
                dateFrom: new Date(dto.dateFrom)
            });
        }
        if (dto.dateTo) {
            const endOfDay = new Date(dto.dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            countQb.andWhere("order.createdAt <= :dateTo", {
                dateTo: endOfDay
            });
        }

        const total = await countQb.getCount();

        const orders = rawRows.map(row => ({
            id: row.order_id,
            trackingNumber: row.order_trackingNumber,
            orderReference: row.order_orderReference,
            customerName: row.order_customerName,
            customerPhone: row.order_customerPhone,
            customerEmail: row.order_customerEmail ?? null,
            pickupLocation: row.order_pickupLocation,
            dropoffLocation: row.order_dropoffLocation,
            status: row.order_status,
            priority: row.order_priority,
            createdAt: row.order_createdAt,
            totalItems: Number(row.totalItems) || 0
        }));

        return {
            orders,
            total,
            page,
            pageSize
        };
    }

    private async queryCompanies(dto: ListCompaniesDto) {
        const query = this.companyRepo
            .createQueryBuilder("company")
            .leftJoin(
                UserRole,
                "owner",
                "owner.companyId = company.id AND owner.role = :ownerRole",
                { ownerRole: TeamRoleType.OWNER }
            )
            .leftJoin(
                Subscription,
                "subscription",
                "subscription.companyId = company.id"
            )
            .addSelect([
                "company.id",
                "company.name",
                "company.email",
                "company.logoUrl",
                "company.timezone",
                "company.createdAt"
            ])
            .addSelect("owner.name", "owner_name")
            .addSelect("owner.email", "owner_email")
            .addSelect("subscription.plan", "plan")
            .addSelect("subscription.status", "subscription_status")
            .addSelect("subscription.currentPeriodEnd", "current_period_end")
            // Subqueries for counts
            .addSelect(
                subQuery =>
                    subQuery
                        .select("COUNT(*)", "totalOrders")
                        .from(Order, "o")
                        .where("o.companyId = company.id"),
                "total_orders"
            )
            .addSelect(
                subQuery =>
                    subQuery
                        .select("COUNT(*)", "totalDrivers")
                        .from(UserRole, "ur")
                        .where("ur.companyId = company.id")
                        .andWhere("ur.role = :driverRole", {
                            driverRole: TeamRoleType.DRIVER
                        })
                        .andWhere("ur.status = :activeStatus", {
                            activeStatus: TeamMemberStatus.ACTIVE
                        }),
                "total_drivers"
            )
            .addSelect(
                subQuery =>
                    subQuery
                        .select("COUNT(*)", "totalTeamMembers")
                        .from(UserRole, "ur2")
                        .where("ur2.companyId = company.id")
                        .andWhere("ur2.status = :activeStatus", {
                            activeStatus: TeamMemberStatus.ACTIVE
                        }),
                "total_team_members"
            );

        // Filters
        if (dto.search) {
            query.andWhere(
                new Brackets(qb => {
                    qb.where("LOWER(company.name) LIKE LOWER(:search)", {
                        search: `%${dto.search}%`
                    }).orWhere("LOWER(company.email) LIKE LOWER(:search)", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }

        if (dto.plan) {
            query.andWhere("subscription.plan = :plan", { plan: dto.plan });
        }

        if (dto.status) {
            query.andWhere("subscription.status = :status", {
                status: dto.status
            });
        }

        // Sorting
        switch (dto.sort) {
            case CompanySort.OLDEST:
                query.orderBy("company.createdAt", "ASC");
                break;
            case CompanySort.NAME_AZ:
                query.orderBy("company.name", "ASC");
                break;
            case CompanySort.NAME_ZA:
                query.orderBy("company.name", "DESC");
                break;
            default:
                query.orderBy("company.createdAt", "DESC");
        }

        // Pagination
        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;
        query.skip((page - 1) * pageSize).take(pageSize);

        const rawRows = await query.getRawMany<CompanyRow>();

        // Count total for pagination (no skip/take, only filters)
        const countQuery = this.companyRepo
            .createQueryBuilder("company")
            .leftJoin(
                Subscription,
                "subscription",
                "subscription.companyId = company.id"
            );

        if (dto.search) {
            countQuery.andWhere(
                new Brackets(qb => {
                    qb.where("LOWER(company.name) LIKE LOWER(:search)", {
                        search: `%${dto.search}%`
                    }).orWhere("LOWER(company.email) LIKE LOWER(:search)", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }
        if (dto.plan) {
            countQuery.andWhere("subscription.plan = :plan", {
                plan: dto.plan
            });
        }
        if (dto.status) {
            countQuery.andWhere("subscription.status = :status", {
                status: dto.status
            });
        }

        const total = await countQuery.getCount();

        const companies = rawRows.map(row => ({
            id: row.company_id,
            name: row.company_name,
            email: row.company_email,
            logoUrl: row.company_logo_url ?? null,
            timezone: row.company_timezone,
            createdAt: row.company_created_at,
            plan: row.plan ?? "free",
            subscriptionStatus: row.subscription_status ?? "active",
            currentPeriodEnd: row.current_period_end ?? null,
            ownerName: row.owner_name ?? "Unknown",
            ownerEmail: row.owner_email ?? null,
            totalOrders: Number(row.total_orders) || 0,
            totalDrivers: Number(row.total_drivers) || 0,
            totalTeamMembers: Number(row.total_team_members) || 0
        }));

        return {
            companies,
            total,
            page,
            pageSize
        };
    }

    private async buildCompanyDetail(
        companyId: string,
        dto: GetCompanyDetailDto
    ) {
        const company = await this.companyRepo.findOne({
            where: { id: companyId }
        });
        if (!company) {
            throw new ResourceNotFoundException("Company not found");
        }

        const [
            subscription,
            usage,
            owner,
            teamMembersResult,
            apiKeys,
            webhooks
        ] = await Promise.all([
            this.subscriptionRepo.findOne({ where: { companyId } }),
            this.usageRepo.findOne({ where: { companyId } }),
            this.userRoleRepo.findOne({
                where: { companyId, role: TeamRoleType.OWNER }
            }),
            this.userRoleRepo.findAndCount({
                where: { companyId },
                order: { createdAt: "ASC" },
                skip: (dto.teamPage - 1) * dto.teamPageSize,
                take: dto.teamPageSize
            }),
            this.apiKeyRepo.find({
                where: { companyId },
                order: { createdAt: "DESC" },
                select: {
                    id: true,
                    name: true,
                    keyPreview: true,
                    expiresAt: true,
                    createdAt: true,
                    updatedAt: true
                }
            }),
            this.webhookRepo.find({
                where: { companyId },
                order: { createdAt: "DESC" },
                select: {
                    id: true,
                    description: true,
                    url: true,
                    events: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true
                }
            })
        ]);

        const [teamMembers, teamMembersTotal] = teamMembersResult;

        const planLimits = getPlanUsageLimits(
            subscription?.plan ?? SubscriptionPlan.FREE
        );

        const response = {
            company: {
                id: company.id,
                name: company.name,
                email: company.email,
                logoUrl: company.logoUrl ?? null,
                timezone: company.timezone,
                createdAt: company.createdAt
            },
            subscription: subscription
                ? {
                      plan: subscription.plan,
                      status: subscription.status,
                      currentPeriodEnd: subscription.currentPeriodEnd,
                      paymentProvider: subscription.paymentProvider,
                      paymentCustomerId: subscription.paymentCustomerId,
                      paymentSubscriptionId: subscription.paymentSubscriptionId
                  }
                : null,
            usage: usage
                ? {
                      ordersThisPeriod: usage.ordersThisPeriod ?? 0,
                      orderLimit: planLimits.orderLimit ?? null,
                      teamMembersCount: usage.teamMembersCount ?? 0,
                      teamMemberLimit: planLimits.teamMemberLimit ?? null
                  }
                : {
                      ordersThisPeriod: 0,
                      orderLimit: null,
                      teamMembersCount: 0,
                      teamMemberLimit: null
                  },
            owner: owner
                ? {
                      userId: owner.userId,
                      name: owner.name ?? "Unknown",
                      email: owner.email,
                      avatarUrl: owner.avatarUrl ?? null
                  }
                : null,
            teamMembers: teamMembers.map(member => ({
                id: member.id,
                userId: member.userId,
                name: member.name ?? member.email,
                email: member.email,
                avatarUrl: member.avatarUrl ?? null,
                role: member.role,
                status: member.status,
                invitedAt: member.invitedAt,
                joinedAt: member.joinedAt
            })),
            teamMembersTotal,
            teamMembersPage: dto.teamPage,
            teamMembersPageSize: dto.teamPageSize,
            apiKeys,
            webhooks
        };

        this.logger.log({
            msg: "Loaded company detail",
            companyId,
            teamMembersTotal,
            apiKeys: apiKeys.length,
            webhooks: webhooks.length
        });

        return response;
    }

    private buildCacheKey(dto: ListCompaniesDto): string {
        const parts = [
            dto.search ?? "",
            dto.plan ?? "",
            dto.status ?? "",
            dto.sort ?? CompanySort.NEWEST,
            dto.page ?? 1,
            dto.pageSize ?? 20
        ];
        return `admin:companies:list:${parts.join("|")}`;
    }

    async listApiKeys(companyId: string, dto: ListApiKeysDto) {
        const cacheKey = `admin:companies:${companyId}:api-keys:${this.buildApiKeysCacheKey(
            dto
        )}`;

        try {
            return await this.cache.getOrSet(
                cacheKey,
                this.CACHE_TTL_SECONDS,
                () => this.queryApiKeys(companyId, dto)
            );
        } catch (err) {
            this.errorHandler.handle(err, "AdminCompaniesService.listApiKeys", [
                rule(
                    QueryFailedError,
                    () =>
                        new InternalErrorException(
                            "Unable to list API keys. Please try again."
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

    private async queryApiKeys(companyId: string, dto: ListApiKeysDto) {
        const company = await this.companyRepo.findOne({
            where: { id: companyId }
        });
        if (!company) {
            throw new ResourceNotFoundException("Company not found");
        }

        const page = dto.page ?? 1;
        const pageSize = dto.pageSize ?? 20;
        const now = new Date();

        const qb = this.apiKeyRepo
            .createQueryBuilder("key")
            .select([
                "key.id",
                "key.name",
                "key.keyPreview",
                "key.revokedAt",
                "key.expiresAt",
                "key.lastUsedAt",
                "key.createdAt",
                "key.updatedAt"
            ])
            .where("key.companyId = :companyId", { companyId })
            .andWhere("key.deletedAt IS NULL");

        // Search filter
        if (dto.search) {
            qb.andWhere(
                new Brackets(sqb => {
                    sqb.where("key.name ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("key.keyPreview ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }

        // Status filter
        if (dto.status && dto.status !== ApiKeyStatusFilter.ALL) {
            switch (dto.status) {
                case ApiKeyStatusFilter.ACTIVE:
                    qb.andWhere("key.revokedAt IS NULL").andWhere(
                        "(key.expiresAt IS NULL OR key.expiresAt > :now)",
                        { now }
                    );
                    break;
                case ApiKeyStatusFilter.REVOKED:
                    qb.andWhere("key.revokedAt IS NOT NULL");
                    break;
                case ApiKeyStatusFilter.EXPIRED:
                    qb.andWhere("key.revokedAt IS NULL")
                        .andWhere("key.expiresAt IS NOT NULL")
                        .andWhere("key.expiresAt <= :now", { now });
                    break;
            }
        }

        qb.orderBy("key.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const apiKeyEntities = await qb.getMany();

        // Count total with same filters
        const countQb = this.apiKeyRepo
            .createQueryBuilder("key")
            .where("key.companyId = :companyId", { companyId })
            .andWhere("key.deletedAt IS NULL");

        if (dto.search) {
            countQb.andWhere(
                new Brackets(sqb => {
                    sqb.where("key.name ILIKE :search", {
                        search: `%${dto.search}%`
                    }).orWhere("key.keyPreview ILIKE :search", {
                        search: `%${dto.search}%`
                    });
                })
            );
        }

        if (dto.status && dto.status !== ApiKeyStatusFilter.ALL) {
            switch (dto.status) {
                case ApiKeyStatusFilter.ACTIVE:
                    countQb
                        .andWhere("key.revokedAt IS NULL")
                        .andWhere(
                            "(key.expiresAt IS NULL OR key.expiresAt > :now)",
                            { now }
                        );
                    break;
                case ApiKeyStatusFilter.REVOKED:
                    countQb.andWhere("key.revokedAt IS NOT NULL");
                    break;
                case ApiKeyStatusFilter.EXPIRED:
                    countQb
                        .andWhere("key.revokedAt IS NULL")
                        .andWhere("key.expiresAt IS NOT NULL")
                        .andWhere("key.expiresAt <= :now", { now });
                    break;
            }
        }

        const total = await countQb.getCount();

        const apiKeys = apiKeyEntities.map(key => {
            let status = "active";
            if (key.revokedAt) {
                status = "revoked";
            } else if (key.expiresAt && key.expiresAt <= now) {
                status = "expired";
            }

            return {
                id: key.id,
                name: key.name,
                keyPreview: key.keyPreview,
                status,
                revokedAt: key.revokedAt,
                expiresAt: key.expiresAt,
                lastUsedAt: key.lastUsedAt,
                createdAt: key.createdAt,
                updatedAt: key.updatedAt
            };
        });

        return {
            company: {
                id: company.id,
                name: company.name
            },
            apiKeys,
            total,
            page,
            pageSize
        };
    }

    private buildApiKeysCacheKey(dto: ListApiKeysDto): string {
        const parts = [
            dto.search ?? "",
            dto.status ?? ApiKeyStatusFilter.ALL,
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
}
