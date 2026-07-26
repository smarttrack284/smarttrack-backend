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
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { UsersService } from '#/modules/users/users.service';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Roles } from '#/common/decorators/roles.decorator';
import { RolesGuard } from '#/common/guards/roles.guard';
import { TeamRoleType } from '#/common/types/team-role.type';

@UseGuards(SupabaseAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(dto, user.id);
  }

  @Get()
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.ordersService.listOrdersForCompanyCached(
      userRole.companyId,
      query,
    );
  }
  //
  // @Get(':orderId')
  // async findOrderById(
  //   @CurrentUser() user: AuthenticatedUser,
  //   @Param('orderId', ParseUUIDPipe) orderId: string,
  // ) {
  //   const userRole = await this.usersService.getUserRoleByUserId(user.id);
  //   return this.ordersService.getOrderByIdForCompany(
  //     orderId,
  //     userRole.companyId,
  //   );
  // }

  @Get(':orderReference')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async findOrderByReference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderReference') orderReference: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    return this.ordersService.getOrderByReferenceForCompany(
      orderReference,
      userRole.companyId,
    );
  }

  @Patch(':orderId/status')
  @Roles(
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN,
    TeamRoleType.DISPATCHER,
    TeamRoleType.DRIVER,
  )
  async updateOrderStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.ordersService.updateOrderStatusForCompany(
      orderId,
      userRole.companyId,
      dto,
      user.id,
    );
    return { success: true };
  }

  @Patch(':orderId')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async updateOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderDto,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.ordersService.updateOrderForCompany(
      orderId,
      userRole.companyId,
      dto,
    );
    return {
      success: true,
    };
  }

  @Delete(':orderId')
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async removeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);
    await this.ordersService.deleteOrderForCompany(
      orderId,
      userRole.companyId,
      user.id,
    );
    return { success: true };
  }
}
