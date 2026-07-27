import type { OrderItemDto } from '#/modules/orders/dto/order-item.dto';
import type { CreateOrderDto } from '#/modules/orders/dto/create-order.dto';
import type { CsvOrderRowDto } from '#/modules/orders/dto/csv-order-row.dto';

export type ParsedItemsResult = { items: OrderItemDto[] } | { error: string };

/** Parses the "Name:qty|Name:qty" items column. Returns a descriptive error rather than throwing, so the caller can attach it to that row's failure reason without a try/catch. */
export function parseItemsColumn(raw: string): ParsedItemsResult {
  const segments = raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return {
      error:
        'items column is empty — expected format "Name:quantity|Name:quantity"',
    };
  }

  const items: OrderItemDto[] = [];
  for (const segment of segments) {
    const [name, qtyRaw] = segment.split(':').map((s) => s.trim());
    const quantity = Number(qtyRaw);

    if (!name) {
      return { error: `Could not parse item name in "${segment}"` };
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        error: `Invalid quantity for "${name}" — must be a whole number of at least 1`,
      };
    }

    items.push({ name, quantity });
  }

  return { items };
}

/** Assembles a validated CsvOrderRowDto (with its items already parsed) into the exact shape createOrder expects — no pickupSavedLocationId, ever. */
export function mapCsvRowToCreateOrderDto(
  row: CsvOrderRowDto,
  items: OrderItemDto[],
): CreateOrderDto {
  return {
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    pickupLocation: {
      label: row.pickupLabel,
      address: row.pickupAddress,
      lat: row.pickupLat,
      lng: row.pickupLng,
    },
    dropoffLocation: {
      label: row.dropoffLabel,
      address: row.dropoffAddress,
      lat: row.dropoffLat,
      lng: row.dropoffLng,
    },
    items,
    priority: row.priority,
    scheduledFor: row.scheduledFor,
    notes: row.notes,
  } as CreateOrderDto;
}
