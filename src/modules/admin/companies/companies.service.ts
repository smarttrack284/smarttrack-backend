import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, Repository } from "typeorm";
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
    InternalErrorException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { QueryFailedError } from "typeorm";
import { ListCompaniesDto, CompanySort } from "./dto/list-companies.dto";
import { GetCompanyDetailDto } from "./dto/get-company-detail.dto";
import { TeamRoleType } from "#/common/types/team-role.type";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import { getPlanUsageLimits, SubscriptionPlan } from "#/common/constants/subscription-plan.constant";

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
        private readonly errorHandler: ErrorHandlerService
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
            webhooks,
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
}