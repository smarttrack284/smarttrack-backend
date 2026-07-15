import {
    Delete,
    HttpCode,
    HttpStatus,
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards
} from "@nestjs/common";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { UsersService } from "#/modules/users/users.service";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { ListOrdersQueryDto } from "./dto/list-orders.query.dto";
import { UpdateOrderDto } from "./dto/update-order.dto";



@UseGuards(SupabaseAuthGuard)
@Controller("orders")
export class OrdersController {
    constructor(
        private readonly ordersService: OrdersService,
        private readonly usersService: UsersService
    ) {}

    @Post()
    async createOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateOrderDto
    ) {
        return this.ordersService.createOrder(dto, user.id);
    }

    @Get()
    async listOrders(
        @CurrentUser() user: AuthenticatedUser,
        @Query() query: ListOrdersQueryDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.ordersService.listOrdersForCompany(
            userRole.companyId,
            query
        );
    }

    @Get(":orderId")
    async findOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.ordersService.getOrderByIdForCompany(
            orderId,
            userRole.companyId
        );
    }

    @Patch(":orderId/status")
    async updateOrderStatus(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string,
        @Body() dto: UpdateOrderStatusDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.ordersService.updateOrderStatusForCompany(
            orderId,
            userRole.companyId,
            dto
        );
    }

    @Patch(":orderId")
    async updateOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string,
        @Body() dto: UpdateOrderDto
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        return this.ordersService.updateOrderForCompany(
            orderId,
            userRole.companyId,
            dto
        );
    }

    @Delete(":orderId")
    @HttpCode(HttpStatus.NO_CONTENT)
    async removeOrder(
        @CurrentUser() user: AuthenticatedUser,
        @Param("orderId", ParseUUIDPipe) orderId: string
    ) {
        const userRole = await this.usersService.getUserRoleByUserId(user.id);
        await this.ordersService.deleteOrderForCompany(
            orderId,
            userRole.companyId
        );
    }
}
