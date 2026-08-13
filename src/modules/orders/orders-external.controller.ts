import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiKeyGuard } from '#/common/guards/api-key.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { APIThrottle } from '#/common/decorators/throttle.decorator';

@Controller('external/order')
@UseGuards(ApiKeyGuard)
@APIThrottle()
export class OrdersExternalController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(@Req() request: FastifyRequest, @Body() dto: CreateOrderDto) {
    const companyId = request.apiKeyCompanyId!;
    return this.ordersService.createOrderForCompanyViaApi(companyId, dto);
  }

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query() query: ListOrdersQueryDto,
  ) {
    const companyId = request.apiKeyCompanyId!;
    return this.ordersService.listOrdersForCompanyViaApi(companyId, query);
  }

  @Get(':id')
  async findOne(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const companyId = request.apiKeyCompanyId!;
    return this.ordersService.getOrderByIdForCompany(id, companyId);
  }

  @Get('tracking/:trackingNumber')
  async findByTrackingNumber(
    @Req() request: FastifyRequest,
    @Param('trackingNumber') trackingNumber: string,
  ) {
    const companyId = request.apiKeyCompanyId!;
    return this.ordersService.getOrderByTrackingNumberForCompany(
      trackingNumber,
      companyId,
    );
  }
}
