import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    UseGuards
} from "@nestjs/common";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminCompaniesService } from "./companies.service";
import { ListCompaniesDto } from "./dto/list-companies.dto";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";
import { GetCompanyDetailDto } from "./dto/get-company-detail.dto";
import { UpdateCompanyPlanDto } from "#/modules/admin/companies/dto/update-company-plan.dto";
import { SendPasswordResetDto } from "#/modules/admin/companies/dto/send-password-reset.dto";
import { ListCompanyOrdersDto } from "#/modules/admin/companies/dto/list-company-orders.dto";
import { RevokeApiKeyDto } from "#/modules/admin/companies/dto/revoke-api-key.dto";
import { ListWebhookDeliveriesAdminDto } from "#/modules/admin/companies/dto/list-webhook-deliveries-admin.dto";
import { ToggleWebhookEndpointDto } from "#/modules/admin/companies/dto/toggle-webhook-endpoint.dto";
import { ChangeOwnerDto } from "#/modules/admin/companies/dto/change-owner.dto";
import { FastifyRequest } from "fastify";
import { ListApiKeysDto } from "./dto/list-api-keys.dto";
import { ListWebhookEndpointsDto } from "./dto/list-webhook-endpoints.dto";

@UseGuards(AdminAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller("admin")
export class AdminCompaniesController {
    constructor(
        private readonly adminCompaniesService: AdminCompaniesService
    ) {}

    @Get("companies")
    async listCompanies(@Query() dto: ListCompaniesDto) {
        return this.adminCompaniesService.listCompanies(dto);
    }

    @Get(":id")
    async getCompanyDetail(
        @Param("id", ParseUUIDPipe) id: string,
        @Query() dto: GetCompanyDetailDto
    ) {
        return this.adminCompaniesService.getCompanyDetail(id, dto);
    }

    @Get(":id/orders")
    async listCompanyOrders(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Query() dto: ListCompanyOrdersDto
    ) {
        return this.adminCompaniesService.listCompanyOrders(companyId, dto);
    }

    @Get(":id/webhook-deliveries")
    async listWebhookDeliveries(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Query() dto: ListWebhookDeliveriesAdminDto
    ) {
        return this.adminCompaniesService.listWebhookDeliveries(companyId, dto);
    }

    @Get(":id/api-keys")
    async listApiKeys(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Query() dto: ListApiKeysDto
    ) {
        return this.adminCompaniesService.listApiKeys(companyId, dto);
    }

    @Get(":id/webhook-endpoints")
    async listWebhookEndpoints(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Query() dto: ListWebhookEndpointsDto
    ) {
        return this.adminCompaniesService.listWebhookEndpoints(companyId, dto);
    }

    @Post(":id/plan")
    async changeCompanyPlan(
        @Param("id", ParseUUIDPipe) id: string,
        @Req() request: FastifyRequest,
        @Body() dto: UpdateCompanyPlanDto
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.changeCompanyPlan(
            id,
            adminUserId,
            dto
        );
    }

    @Post(":id/send-password-reset")
    async sendPasswordReset(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Body() dto: SendPasswordResetDto,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.sendPasswordReset(
            companyId,
            adminUserId,
            dto
        );
    }

    @Post(":id/revoke-api-key")
    async revokeApiKey(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Body() dto: RevokeApiKeyDto,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.revokeApiKey(
            companyId,
            adminUserId,
            dto
        );
    }

    @Post(":id/suspend")
    async suspendCompany(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.suspendCompany(
            companyId,
            adminUserId
        );
    }

    @Post(":id/reactivate")
    async reactivateCompany(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.reactivateCompany(
            companyId,
            adminUserId
        );
    }

    @Post(":id/webhook-endpoints/:endpointId/toggle")
    async toggleWebhookEndpoint(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Param("endpointId", ParseUUIDPipe) endpointId: string,
        @Body() dto: ToggleWebhookEndpointDto,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.toggleWebhookEndpoint(
            companyId,
            adminUserId,
            endpointId,
            dto
        );
    }

    @Post(":id/change-owner")
    async changeOwner(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Body() dto: ChangeOwnerDto,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.changeOwner(
            companyId,
            adminUserId,
            dto
        );
    }

    @Delete(":id")
    async deleteCompany(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Req() request: FastifyRequest
    ) {
        const adminUserId = (request as any).adminUser.userId;
        return this.adminCompaniesService.deleteCompany(companyId, adminUserId);
    }
}
