import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { PlanGuard } from "#/common/guards/plan.guard";
import { RequirePlan } from "#/common/decorators/require-plan.decorator";
import { RolesGuard } from "#/common/guards/roles.guard";
import { Roles } from "#/common/decorators/roles.decorator";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { TeamRoleType } from "#/common/types/team-role.type";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { UsersService } from "#/modules/users/users.service";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

/**
 * Matches the frontend's already-built ApiKeysSection URLs exactly
 * (companies/api-keys, companies/api-keys/:id/revoke), not restructured
 * to a more "correct" REST shape — the frontend was wired against these
 * specific paths, and there's no reason to make it change now that the
 * backend finally exists.
 *
 * Pro-gated AND owner-only, stacked — a key can act on the whole
 * workspace's API surface, so beyond just being a paid feature, only the
 * owner should be able to mint or revoke one, same reasoning that put
 * Billing/Danger Zone behind an owner-only role check in
 * settings-sections.ts.
 */
@UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
@RequirePlan(SubscriptionPlan.PRO)
@Roles(TeamRoleType.OWNER)
@Controller("companies/api-keys")
export class ApiKeysController {
    constructor(
        private readonly apiKeysService: ApiKeysService,
        private readonly usersService: UsersService
    ) {}

    @Post()
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateApiKeyDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.apiKeysService.createApiKey(userRole.companyId, dto);
    }

    @Get()
    async list(@CurrentUser() user: AuthenticatedUser) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.apiKeysService.listForCompany(userRole.companyId);
    }

    @Post(":id/revoke")
    async revoke(
        @CurrentUser() user: AuthenticatedUser,
        @Param("id", ParseUUIDPipe) id: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.apiKeysService.revokeApiKey(userRole.companyId, id);
        return { success: true };
    }
}
