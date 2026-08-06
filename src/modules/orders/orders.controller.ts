import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Req,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { ListOrdersQueryDto } from "./dto/list-orders.query.dto";
import { UpdateOrderDto } from "./dto/update-order.dto";
import { Roles } from "#/common/decorators/roles.decorator";
import { RolesGuard } from "#/common/guards/roles.guard";
import { TeamRoleType } from "#/common/types/team-role.type";
import { RequirePlan } from "#/common/decorators/require-plan.decorator";
import { PlanGuard } from "#/common/guards/plan.guard";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { FastifyRequest } from "fastify";
import { BadRequestAppException } from "#/common/exceptions";

@Controller("orders")
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Post()
    async createOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateOrderDto
    ) {
        return this.ordersService.createOrder(dto, user.id, user.companyId!);
    }

    @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
    @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Post("import")
    async importCsv(
        @CurrentUser() user: AuthenticatedUser,
        @Req() request: FastifyRequest
    ) {
        const file = await request.file();
        if (!file || file.mimetype !== "text/csv") {
            throw new BadRequestAppException("Upload a valid .csv file");
        }
        const buffer = await file.toBuffer();

        return this.ordersService.importOrdersFromCsv(
            user.companyId!,
            user.id,
            buffer
        );
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Get()
    async listOrders(
        @CurrentUser() user: AuthenticatedUser,
        @Query() query: ListOrdersQueryDto
    ) {
        return this.ordersService.listOrdersForCompanyCached(
            user.companyId!,
            query
        );
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Get(":orderReference")
    async findOrderByReference(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderReference") orderReference: string
    ) {
        return this.ordersService.getOrderByReferenceForCompany(
            orderReference,
            user.companyId!
        );
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(
        TeamRoleType.OWNER,
        TeamRoleType.ADMIN,
        TeamRoleType.DISPATCHER,
        TeamRoleType.DRIVER
    )
    @Patch(":orderId/status")
    async updateOrderStatus(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string,
        @Body() dto: UpdateOrderStatusDto
    ) {
        await this.ordersService.updateOrderStatusForCompany(
            orderId,
            user.companyId!,
            dto,
            user.id
        );
        return { success: true };
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Patch(":orderId")
    async updateOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string,
        @Body() dto: UpdateOrderDto
    ) {
        await this.ordersService.updateOrderForCompany(
            orderId,
            user.companyId!,
            dto
        );
        return { success: true };
    }

    @UseGuards(SupabaseAuthGuard, RolesGuard)
    @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
    @Delete(":orderId")
    async removeOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string
    ) {
        await this.ordersService.deleteOrderForCompany(
            orderId,
            user.companyId!,
            user.id
        );
        return { success: true };
    }
}
