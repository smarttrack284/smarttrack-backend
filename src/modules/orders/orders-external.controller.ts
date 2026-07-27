import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Req } from "@nestjs/common";
import { ApiKeyGuard } from "#/common/guards/api-key.guard";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { ListOrdersQueryDto } from "./dto/list-orders.query.dto";

/**
 * The API-key-authenticated surface for Orders — deliberately narrower
 * than OrdersController. External systems can CREATE and READ orders,
 * but cannot change status, assign drivers, edit, or delete — those are
 * operational actions tied to a real dispatcher acting inside the app,
 * not something a machine credential should be able to do unattended.
 * Scoped by request.apiKeyCompanyId (set by ApiKeyGuard), never a user
 * session — there is no @CurrentUser() anywhere in this file.
 */
@UseGuards(ApiKeyGuard)
@Controller("external/orders")
export class OrdersExternalController {
    constructor(private readonly ordersService: OrdersService) {}

    @Post()
    async create(@Req() request: FastifyRequest, @Body() dto: CreateOrderDto) {
        const companyId = request.apiKeyCompanyId!;
        // createOrder normally derives companyId from the authenticated user's
        // UserRole — external callers have no user, so this uses the
        // company-scoped variant directly. See the note on OrdersService below.
        return this.ordersService.createOrderForCompany(companyId, dto);
    }

    @Get()
    async list(
        @Req() request: FastifyRequest,
        @Query() query: ListOrdersQueryDto
    ) {
        const companyId = request.apiKeyCompanyId!;
        return this.ordersService.listOrdersForCompanyCached(companyId, query);
    }

    @Get(":id")
    async findOne(
        @Req() request: FastifyRequest,
        @Param("id", ParseUUIDPipe) id: string
    ) {
        const companyId = request.apiKeyCompanyId!;
        return this.ordersService.getOrderByIdForCompany(id, companyId);
    }

    @Get("tracking/:trackingNumber")
    async findByTrackingNumber(
        @Req() request: FastifyRequest,
        @Param("trackingNumber") trackingNumber: string
    ) {
        const companyId = request.apiKeyCompanyId!;
        return this.ordersService.getOrderByTrackingNumberForCompany(
            trackingNumber,
            companyId
        );
    }
}
