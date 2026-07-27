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
import { RequirePlan } from '#/common/decorators/require-plan.decorator';
import { PlanGuard } from '#/common/guards/plan.guard';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';
import { FastifyRequest } from 'fastify';
import { BadRequestAppException } from '#/common/exceptions';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly usersService: UsersService,
  ) {}

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Post()
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(dto, user.id);
  }

  @UseGuards(SupabaseAuthGuard, PlanGuard, RolesGuard)
  @RequirePlan(SubscriptionPlan.STARTER, SubscriptionPlan.PRO)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Post('import')
  async importCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    const userRole = await this.usersService.getUserRoleByUserId(user.id);

    const file = await request.file();
    if (!file || file.mimetype !== 'text/csv') {
      throw new BadRequestAppException('Upload a valid .csv file');
    }
    const buffer = await file.toBuffer();

    return this.ordersService.importOrdersFromCsv(
      userRole.companyId,
      user.id,
      buffer,
    );
  }
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Get()
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
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Get(':orderReference')
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

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN,
    TeamRoleType.DISPATCHER,
    TeamRoleType.DRIVER,
  )
  @Patch(':orderId/status')
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

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Patch(':orderId')
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

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  @Delete(':orderId')
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
