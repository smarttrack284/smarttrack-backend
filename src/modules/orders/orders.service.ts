import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { Order } from "#/common/entities/order.entity";
import { OrderItem } from "#/common/entities/order-item.entity";
import {
    ALLOWED_ORDER_STATUS_TRANSITIONS,
    OrderPriority,
    OrderStatus
} from "#/common/constants/order-status.constant";
import {
    BadRequestAppException,
    ForbiddenAppException,
    InvalidStateTransitionException,
    ResourceConflictException,
    ResourceNotFoundException
} from "#/common/exceptions";
import { generateTrackingNumber } from "#/common/utils/tracking-number.util";
import { UsageService } from "#/modules/usage/usage.service";
import { UsersService } from "#/modules/users/users.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { ListOrdersQueryDto } from "./dto/list-orders.query.dto";
import { generateOrderReference } from "#/common/utils/order-reference.util";
import { UpdateOrderDto } from "#/modules/orders/dto/update-order.dto";
import {
    DELETABLE_ORDER_STATUSES,
    LOCKED_ORDER_STATUSES,
    EditableOrderField,
    getEditableFieldsForStatus
} from "#/common/constants/order-editable-fields.constant";

@Injectable()
export class OrdersService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
        @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
        private readonly usageService: UsageService,
        private readonly usersService: UsersService
    ) {}

    /**
     * Creates an order for the AUTHENTICATED user's own company —
     * companyId is deliberately never accepted from the DTO/body. It's
     * derived server-side via UsersService.getUserRoleByUserId, so a
     * dispatcher can only ever create orders for the company they actually
     * belong to. Same fix already applied to CompaniesService.createCompany.
     *
     * Increments the company's usage counter (and enforces the plan's order
     * limit) in the SAME transaction as the insert — if the order fails to
     * save, the usage increment rolls back with it.
     */
    async createOrder(
        dto: CreateOrderDto,
        createdByUserId: string,
        manager?: EntityManager
    ): Promise<Order> {
        const userRole =
            await this.usersService.getUserRoleByUserId(createdByUserId);

        return this.withTransaction(manager, async trx => {
            await this.usageService.incrementOrderCount(
                userRole.companyId,
                trx
            );

            const trackingNumber = await this.generateUniqueTrackingNumber(trx);
            const orderReference = await this.generateUniqueOrderReference(trx);

            const order = trx.getRepository(Order).create({
                companyId: userRole.companyId,
                trackingNumber,
                orderReference,
                customerName: dto.customerName,
                customerPhone: dto.customerPhone,
                pickupLocation: dto.pickupLocation,
                pickupSavedLocationId: dto.pickupSavedLocationId ?? null,
                dropoffLocation: dto.dropoffLocation,
                items: dto.items.map(item =>
                    trx.getRepository(OrderItem).create(item)
                ),
                priority: dto.priority ?? OrderPriority.NORMAL,
                scheduledFor: dto.scheduledFor
                    ? new Date(dto.scheduledFor)
                    : null,
                notes: dto.notes ?? null,
                createdByUserId,
                status: OrderStatus.PENDING
            });

            return trx.getRepository(Order).save(order);
        });
    }

    /** Unscoped lookup — internal use only (e.g. a future Trip module that already trusts its own scoping). Controllers must use getOrderByIdForCompany instead. */
    async getOrderById(
        orderId: string,
        manager?: EntityManager
    ): Promise<Order> {
        const repo = manager ? manager.getRepository(Order) : this.orderRepo;
        const order = await repo.findOne({
            where: { id: orderId },
            relations: { items: true }
        });
        if (!order) throw new ResourceNotFoundException("Order", orderId);
        return order;
    }

    /**
     * The safe entry point for any request-driven lookup — verifies the
     * order actually belongs to the caller's company before returning it.
     * Without this check, any authenticated user could read/mutate any
     * order by guessing IDs, regardless of which company they belong to.
     */
    async getOrderByIdForCompany(
        orderId: string,
        companyId: string,
        manager?: EntityManager
    ): Promise<Order> {
        const order = await this.getOrderById(orderId, manager);
        if (order.companyId !== companyId) {
            throw new ForbiddenAppException(
                "This order does not belong to your company"
            );
        }
        return order;
    }

    async listOrdersForCompany(companyId: string, query: ListOrdersQueryDto) {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;

        const qb = this.orderRepo
            .createQueryBuilder("order")
            .leftJoinAndSelect("order.items", "items")
            .where("order.companyId = :companyId", { companyId });

        if (query.status) {
            qb.andWhere("order.status = :status", { status: query.status });
        }

        if (query.search) {
            qb.andWhere(
                "(order.trackingNumber ILIKE :search OR order.customerName ILIKE :search OR order.orderReference ILIKE :search)",
                {
                    search: `%${query.search}%`
                }
            );
        }

        if (query.dateFrom) {
            qb.andWhere("order.createdAt >= :dateFrom", {
                dateFrom: new Date(query.dateFrom)
            });
        }

        if (query.dateTo) {
            // Inclusive of the whole end day, same reasoning as the frontend's
            // use-orders.ts dateTo handling — otherwise a dateTo of "today" would
            // silently exclude anything created today after midnight.
            const endOfDay = new Date(query.dateTo);
            endOfDay.setHours(23, 59, 59, 999);
            qb.andWhere("order.createdAt <= :dateTo", { dateTo: endOfDay });
        }

        qb.orderBy("order.createdAt", "DESC")
            .skip((page - 1) * pageSize)
            .take(pageSize);

        const [orders, total] = await qb.getManyAndCount();
        return { orders, total, page, pageSize };
    }
    /**
     * Changes an order's status, enforcing ALLOWED_ORDER_STATUS_TRANSITIONS
     * server-side — mirrors getOrderActions() from the frontend, so the
     * backend never relies on client UI gating alone to prevent an invalid
     * transition (e.g. "delivered" -> "picked_up").
     */
    async updateOrderStatusForCompany(
        orderId: string,
        companyId: string,
        dto: UpdateOrderStatusDto,
        manager?: EntityManager
    ): Promise<Order> {
        return this.withTransaction(manager, async trx => {
            const order = await trx
                .getRepository(Order)
                .findOne({ where: { id: orderId } });
            if (!order) throw new ResourceNotFoundException("Order", orderId);
            if (order.companyId !== companyId) {
                throw new ForbiddenAppException(
                    "This order does not belong to your company"
                );
            }

            const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[order.status];
            if (!allowed.includes(dto.status)) {
                throw new InvalidStateTransitionException(
                    "order",
                    order.status,
                    dto.status
                );
            }

            order.status = dto.status;
            return trx.getRepository(Order).save(order);
        });
    }

    /**
     * Assigns a driver and flips status to ASSIGNED in one step — the actual
     * "which driver, at what sequence in a route" decision belongs to a
     * future Dispatch/Trip module; this is the order-side effect of that
     * decision, called by that module once it exists, not a full dispatch
     * flow on its own.
     */
    async assignDriverForCompany(
        id: string,
        companyId: string,
        driverUserId: string,
        manager?: EntityManager
    ): Promise<Order> {
        return this.withTransaction(manager, async trx => {
            const order = await trx
                .getRepository(Order)
                .findOne({ where: { id } });
            if (!order) throw new ResourceNotFoundException("Order", id);
            if (order.companyId !== companyId) {
                throw new ForbiddenAppException(
                    "This order does not belong to your company"
                );
            }

            const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[order.status];
            if (!allowed.includes(OrderStatus.ASSIGNED)) {
                throw new InvalidStateTransitionException(
                    "order",
                    order.status,
                    OrderStatus.ASSIGNED
                );
            }

            order.assignedDriverUserId = driverUserId;
            order.status = OrderStatus.ASSIGNED;
            return trx.getRepository(Order).save(order);
        });
    }

    /**
     * Updates editable order fields — mirrors the frontend's OrderForm/edit
     * page rule: orders in a terminal status (delivered, cancelled, failed)
     * are locked and can't be edited, since the driver has already acted on
     * the original data. Enforced here server-side rather than trusted from
     * the frontend's `disabled` form state alone — a direct API call could
     * otherwise bypass that UI-only guard entirely.
     *
     * Driver assignment is deliberately NOT editable through this method —
     * same as the frontend, assignment is a separate action
     * (assignDriverForCompany), not a field on a general update.
     */
    async updateOrderForCompany(
        orderId: string,
        companyId: string,
        dto: UpdateOrderDto,
        manager?: EntityManager
    ): Promise<Order> {
        return this.withTransaction(manager, async trx => {
            const order = await trx.getRepository(Order).findOne({
                where: { id: orderId },
                relations: { items: true }
            });
            if (!order) throw new ResourceNotFoundException("Order", orderId);
            if (order.companyId !== companyId) {
                throw new ForbiddenAppException(
                    "This order does not belong to your company"
                );
            }

            if (LOCKED_ORDER_STATUSES.has(order.status)) {
                throw new BadRequestAppException(
                    `This order is ${order.status} and can no longer be edited`
                );
            }

            // Beyond the terminal-status lock above, WHICH fields are editable
            // narrows further as the order physically progresses — e.g. once a
            // driver has picked up, the pickup location and items are historical
            // fact and rewriting them would misrepresent what actually happened,
            // even though the order as a whole isn't locked yet (dropoff address,
            // customer phone, schedule, and notes can still legitimately change).
            const editableFields = getEditableFieldsForStatus(order.status);
            const rejectedFields = this.getDisallowedFieldsInDto(
                dto,
                editableFields
            );
            if (rejectedFields.length > 0) {
                throw new BadRequestAppException(
                    `These fields can't be changed while the order is ${
                        order.status
                    }: ${rejectedFields.join(", ")}`,
                    { rejectedFields, status: order.status }
                );
            }

            if (dto.customerName !== undefined)
                order.customerName = dto.customerName;
            if (dto.customerPhone !== undefined)
                order.customerPhone = dto.customerPhone;
            if (dto.pickupLocation !== undefined)
                order.pickupLocation = dto.pickupLocation;
            if (dto.pickupSavedLocationId !== undefined)
                order.pickupSavedLocationId = dto.pickupSavedLocationId;
            if (dto.dropoffLocation !== undefined)
                order.dropoffLocation = dto.dropoffLocation;
            if (dto.priority !== undefined) order.priority = dto.priority;
            if (dto.scheduledFor !== undefined) {
                order.scheduledFor = dto.scheduledFor
                    ? new Date(dto.scheduledFor)
                    : null;
            }
            if (dto.notes !== undefined) order.notes = dto.notes;

            if (dto.items !== undefined) {
                // Replace the item set entirely rather than trying to diff/merge —
                // matches the frontend's OrderItemsField, which always submits the
                // full current array, not a partial patch.
                await trx
                    .getRepository(OrderItem)
                    .delete({ orderId: order.id });
                order.items = dto.items.map(item =>
                    trx.getRepository(OrderItem).create(item)
                );
            }

            return trx.getRepository(Order).save(order);
        });
    }

    /**
     * Deletes an order outright — only permitted for PENDING or CANCELLED
     * orders (see DELETABLE_ORDER_STATUSES). Any order a driver has actually
     * engaged with (assigned through delivered/failed) must be cancelled
     * instead, via updateOrderStatusForCompany, which preserves the record
     * rather than erasing it.
     *
     * Decrements the company's usage counter in the same transaction as the
     * delete, so a removed order doesn't continue to count against the plan's
     * order limit.
     */
    async deleteOrderForCompany(
        orderId: string,
        companyId: string,
        manager?: EntityManager
    ): Promise<void> {
        await this.withTransaction(manager, async trx => {
            const order = await trx
                .getRepository(Order)
                .findOne({ where: { id: orderId } });
            if (!order) throw new ResourceNotFoundException("Order", orderId);
            if (order.companyId !== companyId) {
                throw new ForbiddenAppException(
                    "This order does not belong to your company"
                );
            }

            if (!DELETABLE_ORDER_STATUSES.has(order.status)) {
                throw new BadRequestAppException(
                    `Orders that are ${order.status} can't be deleted.`,
                    { status: order.status }
                );
            }

            await trx.getRepository(Order).remove(order);
            await this.usageService.decrementOrderCount(companyId, trx);
        });
    }

    private async withTransaction<T>(
        manager: EntityManager | undefined,
        work: (manager: EntityManager) => Promise<T>
    ): Promise<T> {
        if (manager) return work(manager);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const result = await work(queryRunner.manager);
            await queryRunner.commitTransaction();
            return result;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    private async generateUniqueTrackingNumber(
        manager: EntityManager,
        attempt = 0
    ): Promise<string> {
        if (attempt >= 5) {
            throw new ResourceConflictException(
                "Could not generate a unique tracking number — please retry"
            );
        }
        const candidate = generateTrackingNumber();
        const existing = await manager
            .getRepository(Order)
            .findOne({ where: { trackingNumber: candidate } });
        return existing
            ? this.generateUniqueTrackingNumber(manager, attempt + 1)
            : candidate;
    }

    private async generateUniqueOrderReference(
        manager: EntityManager,
        attempt = 0
    ): Promise<string> {
        if (attempt >= 5) {
            throw new ResourceConflictException(
                "Could not generate a unique order reference — please retry"
            );
        }
        const candidate = generateOrderReference();
        const existing = await manager
            .getRepository(Order)
            .findOne({ where: { orderReference: candidate } });
        return existing
            ? this.generateUniqueOrderReference(manager, attempt + 1)
            : candidate;
    }

    /** Diffs the incoming DTO's populated keys against what's allowed for this status — anything present in the DTO but not in the allowed set is rejected explicitly, rather than silently ignored, so a caller finds out immediately rather than wondering why a field didn't take. */
    private getDisallowedFieldsInDto(
        dto: UpdateOrderDto,
        editableFields: Set<EditableOrderField>
    ): EditableOrderField[] {
        const candidateFields: EditableOrderField[] = [
            "customerName",
            "customerPhone",
            "pickupLocation",
            "pickupSavedLocationId",
            "dropoffLocation",
            "items",
            "priority",
            "scheduledFor",
            "notes"
        ];

        return candidateFields.filter(
            field => dto[field] !== undefined && !editableFields.has(field)
        );
    }
}
