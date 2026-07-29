import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Order } from '#/common/entities/order.entity';
import { OrderItem } from '#/common/entities/order-item.entity';
import {
  ALLOWED_ORDER_STATUS_TRANSITIONS,
  OrderPriority,
  OrderStatus,
} from '#/common/constants/order-status.constant';
import {
  BadRequestAppException,
  ForbiddenAppException,
  InvalidStateTransitionException,
  PlanLimitExceededException,
  ResourceConflictException,
  ResourceNotFoundException,
} from '#/common/exceptions';
import { generateTrackingNumber } from '#/common/utils/tracking-number.util';
import { UsageService } from '#/modules/usage/usage.service';
import { UsersService } from '#/modules/users/users.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { generateOrderReference } from '#/common/utils/order-reference.util';
import { UpdateOrderDto } from '#/modules/orders/dto/update-order.dto';
import {
  DELETABLE_ORDER_STATUSES,
  EditableOrderField,
  getEditableFieldsForStatus,
  LOCKED_ORDER_STATUSES,
} from '#/common/constants/order-editable-fields.constant';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ORDER_EVENTS,
  OrderCreatedEvent,
  OrderDeletedEvent,
  OrderDeletedPayload,
  OrdersBulkImportedEvent,
  OrderStatusChangedEvent,
} from '#/common/events/order.events';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { UserRole } from '#/common/entities/user-role.entity';
import { TeamService } from '#/modules/team/team.service';
import { ErrorHandlerService } from '#/common/errors/error-handler.service';
import { CompaniesService } from '#/modules/companies/companies.service';
import { ConfigService } from '@nestjs/config';
import { parse } from 'csv-parse/sync';
import { CsvOrderRowDto } from '#/modules/orders/dto/csv-order-row.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  mapCsvRowToCreateOrderDto,
  parseItemsColumn,
} from '#/modules/orders/utils/csv-order-row.util';

const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

export type ImportOrdersResult = {
  totalRows: number;
  imported: number;
  failed: { row: number; errors: string[] }[];
  skippedDueToPlanLimit: number;
};

@Injectable()
export class OrdersService {
  private readonly logger: Logger = new Logger(OrdersService.name);
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly usageService: UsageService,
    private readonly usersService: UsersService,
    private readonly teamService: TeamService,
    private readonly events: EventEmitter2,
    private readonly cache: RedisCacheService,
    private readonly errorHandler: ErrorHandlerService,
    private readonly companiesService: CompaniesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a new order for a company.
   *
   * Creates an order with its associated items, generates unique tracking
   * identifiers, updates company usage limits, and emits an order created event.
   *
   * @param dto - The order information to create.
   * @param createdByUserId - The unique identifier of the user creating the order.
   * @param manager - Optional transaction entity manager.
   *
   * @returns The created order identifier and reference number.
   *
   * @throws {ResourceNotFoundException}
   * If the user does not have a valid company role.
   */
  async createOrder(
    dto: CreateOrderDto,
    createdByUserId: string,
    emitCreatedEvent: boolean = true,
    manager?: EntityManager,
  ) {
    try {
      const userRole =
        await this.usersService.getUserRoleByUserId(createdByUserId);

      return this.withTransaction(manager, async (trx) => {
        await this.usageService.incrementOrderCount(userRole.companyId, trx);

        const trackingNumber = await this.generateUniqueTrackingNumber(trx);

        const orderReference = await this.generateUniqueOrderReference(trx);

        const order = trx.getRepository(Order).create({
          companyId: userRole.companyId,
          trackingNumber,
          orderReference,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail ?? null,
          pickupLocation: dto.pickupLocation,
          pickupSavedLocationId: dto.pickupSavedLocationId ?? null,
          dropoffLocation: dto.dropoffLocation,
          items: dto.items.map((item) =>
            trx.getRepository(OrderItem).create(item),
          ),
          priority: dto.priority ?? OrderPriority.NORMAL,
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          notes: dto.notes ?? null,
          createdByUserId,
          status: OrderStatus.PENDING,
        });

        const saved = await trx.getRepository(Order).save(order);

        if (emitCreatedEvent) {
          const payload = await this.buildOrderEventPayload(
            saved,
            createdByUserId,
            trx,
          );

          this.events.emit(
            ORDER_EVENTS.CREATED,
            new OrderCreatedEvent({
              ...payload,
              status: saved.status,
            }),
          );
        }

        return {
          id: saved.id,
          orderReference,
        };
      });
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.createOrder');
    }
  }

  /**
   * Imports order from a CSV buffer. Each row is validated independently
   * and, if valid, created through the SAME createOrder path a manual
   * single-order request uses — plan-limit enforcement, tracking-number
   * generation/uniqueness, and usage increments all apply identically, so
   * there's no separate "bulk" code path that could drift from single-order
   * behavior. One bad row doesn't fail the whole import (partial success),
   * but once the plan's order limit is hit, remaining rows are reported as
   * skipped rather than attempted — they'd fail anyway, and attempting each
   * one individually would just be a slower way to find that out.
   */
  async importOrdersFromCsv(
    companyId: string,
    createdByUserId: string,
    fileBuffer: Buffer,
  ): Promise<ImportOrdersResult> {
    if (fileBuffer.length > MAX_IMPORT_FILE_SIZE_BYTES) {
      throw new BadRequestAppException('CSV file exceeds the 2MB size limit');
    }

    let records: Record<string, string>[];
    try {
      records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      throw new BadRequestAppException(
        `Could not parse CSV file: ${
          err instanceof Error ? err.message : 'invalid format'
        }`,
      );
    }

    if (records.length === 0) {
      throw new BadRequestAppException('CSV file contains no data rows');
    }
    if (records.length > MAX_IMPORT_ROWS) {
      throw new BadRequestAppException(
        `CSV file has ${records.length} rows — the maximum per import is ${MAX_IMPORT_ROWS}`,
      );
    }

    const failed: { row: number; errors: string[] }[] = [];
    let imported = 0;
    let skippedDueToPlanLimit = 0;
    let limitReached = false;

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row

      if (limitReached) {
        skippedDueToPlanLimit++;
        continue;
      }

      const rowDto = plainToInstance(CsvOrderRowDto, records[i], {
        enableImplicitConversion: true,
      });
      const validationErrors = await validate(rowDto);

      if (validationErrors.length > 0) {
        failed.push({
          row: rowNumber,
          errors: validationErrors.flatMap((e) =>
            Object.values(e.constraints ?? {}),
          ),
        });
        continue;
      }

      const parsedItems = parseItemsColumn(rowDto.items);
      if ('error' in parsedItems) {
        failed.push({ row: rowNumber, errors: [parsedItems.error] });
        continue;
      }

      const createDto = mapCsvRowToCreateOrderDto(rowDto, parsedItems.items);

      try {
        await this.createOrder(createDto, createdByUserId, false);
        imported++;
      } catch (err) {
        if (err instanceof PlanLimitExceededException) {
          limitReached = true;
          skippedDueToPlanLimit++;
          continue;
        }
        failed.push({
          row: rowNumber,
          errors: [
            err instanceof Error ? err.message : 'Failed to create this order',
          ],
        });
      }
    }

    this.events.emit(
      'order.bulk_imported',
      new OrdersBulkImportedEvent(companyId, imported, failed.length),
    );

    return {
      totalRows: records.length,
      imported,
      failed,
      skippedDueToPlanLimit,
    };
  }

  /**
   * Company-scoped create, for callers that already have a verified
   * companyId with no associated user — API-key authenticated requests,
   * specifically. `createdByUserId` is stored as null; the activity log
   * and any "created by" display should read this as "created via API",
   * not attribute it to a person who never made the request.
   */
  async createOrderForCompany(
    companyId: string,
    dto: CreateOrderDto,
    manager?: EntityManager,
  ): Promise<Order> {
    return this.withTransaction(manager, async (trx) => {
      await this.usageService.incrementOrderCount(companyId, trx);
      const trackingNumber = await this.generateUniqueTrackingNumber(trx);

      const orderReference = await this.generateUniqueOrderReference(trx);

      const order = trx.getRepository(Order).create({
        companyId,
        trackingNumber,
        orderReference,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail,
        pickupLocation: dto.pickupLocation,
        dropoffLocation: dto.dropoffLocation,
        items: dto.items.map((item) =>
          trx.getRepository(OrderItem).create(item),
        ),
        priority: dto.priority ?? OrderPriority.NORMAL,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        notes: dto.notes ?? null,
        createdByUserId: null,
        status: OrderStatus.PENDING,
      });

      const saved = await trx.getRepository(Order).save(order);

      const payload = await this.buildOrderEventPayload(saved, null, trx);

      this.events.emit(
        ORDER_EVENTS.CREATED,
        new OrderCreatedEvent({
          ...payload,
          status: saved.status,
        }),
      );

      return saved;
    });
  }

  async getOrderByTrackingNumberForCompany(
    trackingNumber: string,
    companyId: string,
    manager?: EntityManager,
  ): Promise<Order> {
    const repo = manager ? manager.getRepository(Order) : this.orderRepo;
    const order = await repo.findOne({
      where: { trackingNumber, companyId },
      relations: { items: true },
    });
    if (!order)
      throw new ResourceNotFoundException(
        'The order you are searching for cannot be found',
      );
    if (order.companyId !== companyId)
      throw new ForbiddenAppException(
        'This order does not belong to your company',
      );
    return order;
  }

  /**
   * Retrieves an order by its unique identifier.
   *
   * @param orderId - The unique identifier of the order.
   * @param manager - Optional transaction entity manager.
   *
   * @returns The order details including its items.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   */
  async getOrderById(orderId: string, manager?: EntityManager): Promise<Order> {
    try {
      const repo = manager ? manager.getRepository(Order) : this.orderRepo;

      const order = await repo.findOne({
        where: { id: orderId },
        relations: { items: true },
      });

      if (!order) {
        throw new ResourceNotFoundException(
          'The order you are looking for could not be found.',
        );
      }

      return order;
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.getOrderById');
    }
  }

  /**
   * Retrieves an order by ID and verifies that it belongs to a company.
   *
   * Ensures that the requested order is associated with the specified company
   * before returning the order details.
   *
   * @param orderId - The unique identifier of the order.
   * @param companyId - The unique identifier of the company.
   * @param manager - Optional transaction entity manager.
   *
   * @returns The order details.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the order does not belong to the company.
   */
  async getOrderByIdForCompany(
    orderId: string,
    companyId: string,
    manager?: EntityManager,
  ): Promise<Order> {
    try {
      const order = await this.getOrderById(orderId, manager);

      if (order.companyId !== companyId) {
        throw new ForbiddenAppException(
          'You do not have permission to access this order.',
        );
      }

      return order;
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.getOrderByIdForCompany');
    }
  }

  /**
   * Retrieves an order by its reference number and verifies that it belongs
   * to a company.
   *
   * Includes the assigned driver's information when available.
   *
   * @param orderReference - The unique reference number of the order.
   * @param companyId - The unique identifier of the company.
   *
   * @returns The order details with the assigned driver's name.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the order does not belong to the company.
   */
  async getOrderByReferenceForCompany(
    orderReference: string,
    companyId: string,
  ) {
    try {
      const order = await this.orderRepo.findOne({
        where: { orderReference },
        relations: { items: true },
      });

      if (!order) {
        throw new ResourceNotFoundException(
          'The order you are looking for could not be found.',
        );
      }

      if (order.companyId !== companyId) {
        throw new ForbiddenAppException(
          'You do not have permission to access this order.',
        );
      }

      const driver = await this.teamService.getDriverByIdForCompany(
        companyId,
        order.assignedDriverUserId,
      );

      return {
        ...order,
        driverName: driver?.name,
      };
    } catch (err) {
      this.errorHandler.handle(
        err,
        'OrdersService.getOrderByReferenceForCompany',
      );
    }
  }

  /**
   * Retrieves a paginated list of order belonging to a company.
   *
   * Supports filtering by status, searching by tracking number, customer name,
   * or order reference, and filtering order by creation date range.
   * Also includes assigned driver names when available.
   *
   * @param companyId - The unique identifier of the company.
   * @param query - The order listing filters and pagination options.
   *
   * @returns A paginated list of company order with total count.
   */
  async listOrdersForCompany(companyId: string, query: ListOrdersQueryDto) {
    try {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;

      const qb = this.orderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.items', 'items')
        .where('order.companyId = :companyId', { companyId });

      if (query.status) {
        qb.andWhere('order.status = :status', {
          status: query.status,
        });
      }

      if (query.search) {
        qb.andWhere(
          '(order.trackingNumber ILIKE :search OR order.customerName ILIKE :search OR order.orderReference ILIKE :search)',
          {
            search: `%${query.search}%`,
          },
        );
      }

      if (query.dateFrom) {
        qb.andWhere('order.createdAt >= :dateFrom', {
          dateFrom: new Date(query.dateFrom),
        });
      }

      if (query.dateTo) {
        const endOfDay = new Date(query.dateTo);

        endOfDay.setHours(23, 59, 59, 999);

        qb.andWhere('order.createdAt <= :dateTo', {
          dateTo: endOfDay,
        });
      }

      qb.orderBy('order.createdAt', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize);

      const [orders, total] = await qb.getManyAndCount();

      const driverNameByUserId = await this.getDriverNamesForOrders(
        companyId,
        orders,
      );

      const ordersWithDriverNames = orders.map((order) => ({
        ...order,
        driverName: order.assignedDriverUserId
          ? (driverNameByUserId.get(order.assignedDriverUserId) ?? null)
          : null,
      }));

      return {
        orders: ordersWithDriverNames,
        total,
        page,
        pageSize,
      };
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.listOrdersForCompany');
    }
  }

  /**
   * Updates an order's status for a company.
   *
   * Validates that the order belongs to the company and ensures the requested
   * status change follows the allowed order status transition rules.
   * Emits an event after the status has been successfully updated.
   *
   * @param orderId - The unique identifier of the order.
   * @param companyId - The unique identifier of the company.
   * @param dto - The new order status.
   * @param updatedByUserId - The unique identifier of the user who perform this action
   * @param manager - Optional transaction entity manager.
   *
   * @returns The updated order.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the order is not accessible by the company.
   *
   * @throws {InvalidStateTransitionException}
   * If the requested status change is not allowed.
   */
  async updateOrderStatusForCompany(
    orderId: string,
    companyId: string,
    dto: UpdateOrderStatusDto,
    updatedByUserId: string,
    manager?: EntityManager,
  ) {
    try {
      return this.withTransaction(manager, async (trx) => {
        const order = await trx.getRepository(Order).findOne({
          where: { id: orderId },
        });

        if (!order) {
          throw new ResourceNotFoundException(
            'The order you are trying to update could not be found.',
          );
        }

        if (order.companyId !== companyId) {
          throw new ForbiddenAppException(
            'You do not have permission to update this order.',
          );
        }

        const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[order.status];

        if (!allowed.includes(dto.status)) {
          throw new InvalidStateTransitionException(
            'order',
            order.status,
            dto.status,
          );
        }

        const previousStatus = order.status;

        order.status = dto.status;

        const saved = await trx.getRepository(Order).save(order);

        const payload = await this.buildOrderEventPayload(
          saved,
          updatedByUserId,
          trx,
        );

        this.events.emit(
          ORDER_EVENTS.STATUS_CHANGED,
          new OrderStatusChangedEvent({
            ...payload,
            previousStatus,
            currentStatus: saved.status,
            status: saved.status,
          }),
        );

        return saved;
      });
    } catch (err) {
      this.errorHandler.handle(
        err,
        'OrdersService.updateOrderStatusForCompany',
      );
    }
  }

  /**
   * Assigns a driver to an order for a company.
   *
   * Verifies that the order belongs to the company, validates that the order
   * can transition into the assigned state, assigns the driver, and emits a
   * status change event.
   *
   * @param id - The unique identifier of the order.
   * @param companyId - The unique identifier of the company.
   * @param dispatcherUserId - The unique identifier of the dispatcher who perform the assignment.
   * @param driverUserId - The unique identifier of the driver being assigned.
   * @param manager - Optional transaction entity manager.
   *
   * @returns The updated order with the assigned driver.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the order is not accessible by the company.
   *
   * @throws {InvalidStateTransitionException}
   * If the order cannot be assigned in its current state.
   */
  async assignDriverForCompany(
    id: string,
    companyId: string,
    driverUserId: string,
    dispatcherUserId: string,
    manager?: EntityManager,
  ): Promise<Order> {
    try {
      return this.withTransaction(manager, async (trx) => {
        const order = await trx.getRepository(Order).findOne({
          where: { id },
        });

        if (!order) {
          throw new ResourceNotFoundException(
            'The order you are trying to assign a driver to could not be found.',
          );
        }

        if (order.companyId !== companyId) {
          throw new ForbiddenAppException(
            'You do not have permission to assign a driver to this order.',
          );
        }

        const allowed = ALLOWED_ORDER_STATUS_TRANSITIONS[order.status];

        if (!allowed.includes(OrderStatus.ASSIGNED)) {
          throw new InvalidStateTransitionException(
            'order',
            order.status,
            OrderStatus.ASSIGNED,
          );
        }

        const previousStatus = order.status;

        order.assignedDriverUserId = driverUserId;
        order.status = OrderStatus.ASSIGNED;

        const saved = await trx.getRepository(Order).save(order);

        const payload = await this.buildOrderEventPayload(
          saved,
          dispatcherUserId,
          trx,
        );

        this.events.emit(
          ORDER_EVENTS.STATUS_CHANGED,
          new OrderStatusChangedEvent({
            ...payload,
            previousStatus,
            currentStatus: saved.status,
            status: saved.status,
          }),
        );

        return saved;
      });
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.assignDriverForCompany');
    }
  }
  /**
   * Updates an existing order for a company.
   *
   * Updates editable order information while enforcing order lifecycle rules.
   * Certain fields become unavailable for editing as the order progresses to
   * prevent changes to historical delivery information.
   *
   * @param orderId - The unique identifier of the order.
   * @param companyId - The unique identifier of the company.
   * @param dto - The order information to update.
   * @param manager - Optional transaction entity manager.
   *
   * @returns void after the order has been successfully updated.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the order does not belong to the company.
   *
   * @throws {BadRequestAppException}
   * If the order cannot be edited or contains fields that are not editable
   * in the current order state.
   */
  async updateOrderForCompany(
    orderId: string,
    companyId: string,
    dto: UpdateOrderDto,
    manager?: EntityManager,
  ) {
    try {
      return this.withTransaction(manager, async (trx) => {
        const order = await trx.getRepository(Order).findOne({
          where: { id: orderId },
          relations: { items: true },
        });

        if (!order) {
          throw new ResourceNotFoundException(
            'The order you are trying to update could not be found.',
          );
        }

        if (order.companyId !== companyId) {
          throw new ForbiddenAppException(
            'You do not have permission to update this order.',
          );
        }

        if (LOCKED_ORDER_STATUSES.has(order.status)) {
          throw new BadRequestAppException(
            'This order can no longer be edited.',
          );
        }

        const editableFields = getEditableFieldsForStatus(order.status);

        const rejectedFields = this.getDisallowedFieldsInDto(
          dto,
          editableFields,
        );

        if (rejectedFields.length > 0) {
          throw new BadRequestAppException(
            'Some of the selected fields cannot be changed at this stage of the order.',
            {
              rejectedFields,
              status: order.status,
            },
          );
        }

        if (dto.customerName !== undefined) {
          order.customerName = dto.customerName;
        }

        if (dto.customerPhone !== undefined) {
          order.customerPhone = dto.customerPhone;
        }

        if (dto.pickupLocation !== undefined) {
          order.pickupLocation = dto.pickupLocation;
        }

        if (dto.pickupSavedLocationId !== undefined) {
          order.pickupSavedLocationId = dto.pickupSavedLocationId;
        }

        if (dto.dropoffLocation !== undefined) {
          order.dropoffLocation = dto.dropoffLocation;
        }

        if (dto.priority !== undefined) {
          order.priority = dto.priority;
        }

        if (dto.scheduledFor !== undefined) {
          order.scheduledFor = dto.scheduledFor
            ? new Date(dto.scheduledFor)
            : null;
        }

        if (dto.notes !== undefined) {
          order.notes = dto.notes;
        }

        if (dto.items !== undefined) {
          await trx.getRepository(OrderItem).delete({ orderId: order.id });

          order.items = dto.items.map((item) =>
            trx.getRepository(OrderItem).create(item),
          );
        }

        await trx.getRepository(Order).save(order);
      });
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.updateOrderForCompany');
    }
  }
  /**
   * Deletes an order belonging to a company.
   *
   * Ensures the order exists, belongs to the company, and is in a deletable
   * state before removing it. Updates usage tracking and emits an order deleted
   * event after successful deletion.
   *
   * @param orderId - The unique identifier of the order.
   * @param companyId - The unique identifier of the company.
   * @param deletedByUserId - The unique identifier of the person who perform this action.
   * @param manager - Optional transaction entity manager.
   *
   * @returns void after the order has been successfully deleted.
   *
   * @throws {ResourceNotFoundException}
   * If the order could not be found.
   *
   * @throws {ForbiddenAppException}
   * If the order is not accessible by the company.
   *
   * @throws {BadRequestAppException}
   * If the order cannot be deleted in its current state.
   */
  async deleteOrderForCompany(
    orderId: string,
    companyId: string,
    deletedByUserId: string,
    manager?: EntityManager,
  ) {
    try {
      await this.withTransaction(manager, async (trx) => {
        const order = await trx.getRepository(Order).findOne({
          where: { id: orderId },
        });

        if (!order) {
          throw new ResourceNotFoundException(
            'The order you are trying to delete could not be found.',
          );
        }

        if (order.companyId !== companyId) {
          throw new ForbiddenAppException(
            'You do not have permission to delete this order.',
          );
        }

        if (!DELETABLE_ORDER_STATUSES.has(order.status)) {
          throw new BadRequestAppException(
            'This order cannot be deleted at its current stage.',
            {
              status: order.status,
            },
          );
        }

        // Build payload before deleting the order
        const company = await this.companiesService.getCompanyById(
          companyId,
          trx,
        );

        const deletedBy = await trx.getRepository(UserRole).findOne({
          where: {
            companyId,
            userId: deletedByUserId,
          },
        });

        const payload: OrderDeletedPayload = {
          companyId,
          companyName: company.name,
          orderId: order.id,
          orderReference: order.orderReference,
          customerName: order.customerName,
          deletedBy: deletedBy?.name ?? 'System',
        };

        await trx.getRepository(Order).remove(order);

        await this.usageService.decrementOrderCount(companyId, trx);

        this.events.emit(ORDER_EVENTS.DELETED, new OrderDeletedEvent(payload));
      });
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.deleteOrderForCompany');
    }
  }

  /**
   * Retrieves order KPI counts for a company.
   *
   * Calculates key order metrics including order created today, currently
   * active deliveries, completed order today, and failed order today.
   *
   * @param companyId - The unique identifier of the company.
   * @param startOfToday - The start timestamp used for today's calculations.
   *
   * @returns The company's order KPI metrics.
   */
  async getKpiCountsForCompany(companyId: string, startOfToday: Date) {
    try {
      const raw = await this.orderRepo
        .createQueryBuilder('order')
        .select(
          'COUNT(*) FILTER (WHERE order.createdAt >= :startOfToday)',
          'ordersToday',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE order.status IN ('assigned','picked_up','in_transit'))`,
          'activeDeliveries',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE order.status = 'delivered' AND order.updatedAt >= :startOfToday)`,
          'completedToday',
        )
        .addSelect(
          `COUNT(*) FILTER (WHERE order.status = 'failed' AND order.updatedAt >= :startOfToday)`,
          'failedToday',
        )
        .where('order.companyId = :companyId', {
          companyId,
          startOfToday,
        })
        .getRawOne();

      return {
        ordersToday: Number(raw.ordersToday),
        activeDeliveries: Number(raw.activeDeliveries),
        completedToday: Number(raw.completedToday),
        failedToday: Number(raw.failedToday),
      };
    } catch (err) {
      this.errorHandler.handle(err, 'OrdersService.getKpiCountsForCompany');
    }
  }

  /**
   * Retrieves a company's order using cache when available.
   *
   * Generates a cache key based on the company and query parameters. If cached
   * data exists, it is returned immediately; otherwise, the order are fetched
   * and stored in cache for future requests.
   *
   * @param companyId - The unique identifier of the company.
   * @param query - The order listing filters and pagination options.
   *
   * @returns A paginated list of company order.
   */
  async listOrdersForCompanyCached(
    companyId: string,
    query: ListOrdersQueryDto,
  ) {
    const cacheKey = this.buildOrdersListCacheKey(companyId, query);

    return this.cache.getOrSet(cacheKey, 15, () =>
      this.listOrdersForCompany(companyId, query),
    );
  }

  async invalidateOrdersListCache(cacheKey: string): Promise<void> {
    await this.cache.del(cacheKey);
  }

  buildOrdersListCacheKey(
    companyId: string,
    query: ListOrdersQueryDto,
  ): string {
    const parts = [
      companyId,
      query.status ?? '',
      query.search ?? '',
      query.dateFrom ?? '',
      query.dateTo ?? '',
      query.page ?? 1,
      query.pageSize ?? 20,
    ];
    return `orders:list:${parts.join(':')}`;
  }

  /**
   * Retrieves driver names for a list of order.
   *
   * Finds the drivers assigned to the provided order within a company and
   * returns a map of user IDs to driver names. Orders without assigned drivers
   * or unavailable driver records are ignored.
   *
   * @param companyId - The unique identifier of the company.
   * @param orders - The order containing assigned driver references.
   *
   * @returns A map containing driver user IDs and their names.
   */
  private async getDriverNamesForOrders(
    companyId: string,
    orders: Order[],
  ): Promise<Map<string, string | null>> {
    const driverIds = [
      ...new Set(
        orders
          .map((o) => o.assignedDriverUserId)
          .filter((id): id is string => !!id),
      ),
    ];

    if (driverIds.length === 0) {
      return new Map();
    }

    const drivers = await this.userRoleRepo.find({
      where: {
        companyId,
        userId: In(driverIds),
      },
      select: {
        userId: true,
        name: true,
      },
    });

    return new Map(drivers.map((d) => [d.userId!, d.name]));
  }

  private async withTransaction<T>(
    manager: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
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
    attempt = 0,
  ): Promise<string> {
    if (attempt >= 5) {
      throw new ResourceConflictException(
        'Could not generate a unique tracking number — please retry',
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
    attempt = 0,
  ): Promise<string> {
    if (attempt >= 5) {
      throw new ResourceConflictException(
        'Could not generate a unique order reference — please retry',
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
    editableFields: Set<EditableOrderField>,
  ): EditableOrderField[] {
    const candidateFields: EditableOrderField[] = [
      'customerName',
      'customerPhone',
      'pickupLocation',
      'pickupSavedLocationId',
      'dropoffLocation',
      'items',
      'priority',
      'scheduledFor',
      'notes',
    ];

    return candidateFields.filter(
      (field) => dto[field] !== undefined && !editableFields.has(field),
    );
  }

  private async buildOrderEventPayload(
    order: Order,
    updatedByUserId: string | null,
    manager?: EntityManager,
  ): Promise<{
    companyId: string;
    orderId: string;
    companyName: string;
    customerName: string;
    driverName: string;
    customerEmail: string | null;
    orderReference: string;
    statusLabel: string;
    trackingUrl: string;
    supportEmail: string;
    orderUrl: string;
    updatedBy: string;
    teamRecipients: {
      email: string;
      name: string;
      userId: string;
    }[];
  }> {
    let updatedBy: UserRole | null = null;
    const userRoleRepo = manager
      ? manager.getRepository(UserRole)
      : this.userRoleRepo;

    const company = await this.companiesService.getCompanyById(
      order.companyId,
      manager,
    );

    if (updatedByUserId !== null) {
      updatedBy = await userRoleRepo.findOne({
        where: {
          companyId: order.companyId,
          userId: updatedByUserId,
        },
      });
    }

    const driver = await userRoleRepo.findOne({
      where: {
        companyId: order.companyId,
        userId: order.assignedDriverUserId as string,
      },
    });

    const teamMembers = await userRoleRepo.find({
      where: {
        companyId: order.companyId,
      },
      select: {
        userId: true,
        email: true,
        name: true,
      },
    });

    return {
      companyId: company.id,
      companyName: company.name,
      orderId: order.id,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      orderReference: order.orderReference,
      driverName: driver?.name ?? 'Driver',
      statusLabel: order.status,
      trackingUrl: `${this.config.get('CLIENT_URL')}/track/${
        order.trackingNumber
      }`,
      supportEmail: company.email,
      orderUrl: `${this.config.get('CLIENT_URL')}/dashboard/orders/${order.id}`,
      updatedBy: updatedBy?.name ?? 'Created via API',
      teamRecipients: teamMembers.map((member) => ({
        userId: member.userId as string,
        name: member.name as string,
        email: member.email as string,
      })),
    };
  }
}
