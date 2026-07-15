import { OrderStatus } from './order-status.constant';

export type EditableOrderField =
  | 'customerName'
  | 'customerPhone'
  | 'pickupLocation'
  | 'pickupSavedLocationId'
  | 'dropoffLocation'
  | 'items'
  | 'priority'
  | 'scheduledFor'
  | 'notes';

const ALL_FIELDS: EditableOrderField[] = [
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

/**
 * Once a driver has picked up, the pickup location and the item list are
 * historical fact — the driver already collected a specific set of items
 * from a specific place. Editing either after the fact would let the
 * record say something different from what physically happened. Dropoff
 * address, customer contact, priority, schedule, and notes remain
 * legitimately editable post-pickup (e.g. a corrected delivery address).
 */
const LOCKED_AFTER_PICKUP: EditableOrderField[] = [
  'pickupLocation',
  'pickupSavedLocationId',
  'items',
];

/**
 * Which fields can be updated via updateOrderForCompany, per current
 * order status. Terminal statuses (delivered/cancelled/failed) are
 * handled separately by LOCKED_ORDER_STATUSES — this table only matters
 * for the non-terminal statuses where SOME editing is still allowed.
 */
const EDITABLE_FIELDS_BY_STATUS: Partial<
  Record<OrderStatus, EditableOrderField[]>
> = {
  [OrderStatus.PENDING]: ALL_FIELDS,
  [OrderStatus.ASSIGNED]: ALL_FIELDS,
  [OrderStatus.PICKED_UP]: ALL_FIELDS.filter(
    (f) => !LOCKED_AFTER_PICKUP.includes(f),
  ),
  [OrderStatus.IN_TRANSIT]: ALL_FIELDS.filter(
    (f) => !LOCKED_AFTER_PICKUP.includes(f),
  ),
};

export function getEditableFieldsForStatus(
  status: OrderStatus,
): Set<EditableOrderField> {
  return new Set(EDITABLE_FIELDS_BY_STATUS[status] ?? []);
}
