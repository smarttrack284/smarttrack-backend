import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Req,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { FastifyRequest } from "fastify";
import { FileValidationPipe } from "#/common/pipes/file-validation.pipe";
import { UsersService } from "#/modules/users/users.service";
import { CreateSavedLocationDto } from "./dto/create-saved-location.dto";
import { UpdateSavedLocationDto } from "./dto/update-saved-location.dto";
import { Roles } from "#/common/decorators/roles.decorator";
import { RolesGuard } from "#/common/guards/roles.guard";
import { RequirePlan } from "#/common/decorators/require-plan.decorator";
import { PlanGuard } from "#/common/guards/plan.guard";
import { TeamRoleType } from "#/common/types/team-role.type";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { UpdateCompanyNotificationDto } from "./dto/update-company-notification.dto";

@Controller("companies")
export class CompaniesController {
    constructor(
        private readonly companiesService: CompaniesService,
        private readonly usersService: UsersService
    ) {}

    @UseGuards(SupabaseAuthGuard)
    @Post("register")
    async registerCompany(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateCompanyDto
    ) {
        return this.companiesService.createCompany(dto, user.id);
    }

    @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
    @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Post("saved-locations")
    async createSavedLocation(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateSavedLocationDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        return this.companiesService.createSavedLocation(
            userRole.companyId,
            dto
        );
    }

    @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
    @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Get("saved-locations")
    async listSavedLocations(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        return this.companiesService.listSavedLocations(userRole.companyId);
    }

    @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
    @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Get("saved-locations/:savedLocationId")
    async getSavedLocation(
        @CurrentUser() user: AuthenticatedUser,
        @Param("savedLocationId", ParseUUIDPipe)
        savedLocationId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        return this.companiesService.getSavedLocation(
            userRole.companyId,
            savedLocationId
        );
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
    @Get("notifications")
    async getCompanyNotification(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        return this.companiesService.getCompanyNotification(userRole.companyId);
    }

    @Get(":companyId")
    @Roles() // Anyone
    async findCompany(@Param("companyId", ParseUUIDPipe) companyId: string) {
        return this.companiesService.getCompanyById(companyId);
    }

    @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
    @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Patch("saved-locations/:savedLocationId")
    async updateSavedLocation(
        @CurrentUser() user: AuthenticatedUser,
        @Param("savedLocationId", ParseUUIDPipe)
        savedLocationId: string,
        @Body() dto: UpdateSavedLocationDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        return this.companiesService.updateSavedLocation(
            userRole.companyId,
            savedLocationId,
            dto
        );
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
    @Patch("notifications/update")
    async updateCompanyNotification(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: UpdateCompanyNotificationDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        return this.companiesService.updateCompanyNotification(
            userRole.companyId,
            dto
        );
    }

    @Patch(":companyId")
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN)
    async updateCompany(
        @Param("companyId", ParseUUIDPipe) companyId: string,
        @Req() request: FastifyRequest
    ) {
        // @fastify/multipart parses either a JSON body OR a multipart body —
        // this endpoint needs to accept both, since a text-only update (name/
        // timezone, no new logo) shouldn't force the client into multipart
        // encoding unnecessarily.
        if (!request.isMultipart()) {
            const dto = request.body as UpdateCompanyDto;
            return this.companiesService.updateCompany(companyId, dto);
        }

        const parts = request.parts();
        let dto: Partial<UpdateCompanyDto> = {};
        let logoFile:
            | { buffer: Buffer; contentType: string; extension: string }
            | undefined;

        for await (const part of parts) {
            if (part.type === "file" && part.fieldname === "logo") {
                const buffer = await part.toBuffer();
                const validated = new FileValidationPipe().transform({
                    file: part,
                    buffer
                });
                const extension =
                    validated.file.filename.split(".").pop() ?? "png";
                logoFile = {
                    buffer: validated.buffer,
                    contentType: validated.file.mimetype,
                    extension
                };
            } else if (part.type === "field") {
                (dto as Record<string, unknown>)[part.fieldname] = part.value;
            }
        }

        return this.companiesService.updateCompany(
            companyId,
            dto as UpdateCompanyDto,
            logoFile
        );
    }

    @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
    @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Delete("saved-locations/:savedLocationId")
    async deleteSavedLocation(
        @CurrentUser() user: AuthenticatedUser,
        @Param("savedLocationId", ParseUUIDPipe)
        savedLocationId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);

        await this.companiesService.deleteSavedLocation(
            userRole.companyId,
            savedLocationId
        );

        return {
            success: true
        };
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER)
    @Delete(":companyId")
    async removeCompany(@Param("companyId", ParseUUIDPipe) companyId: string) {
        await this.companiesService.deleteCompany(companyId);
        return { success: true };
    }
}
