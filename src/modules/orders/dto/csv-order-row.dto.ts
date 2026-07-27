import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OrderPriority } from '#/common/constants/order-status.constant';

/**
 * Flat, one-row-per-order shape — CSV can't represent CreateOrderDto's
 * nested objects (pickupLocation, items) directly, so those are flattened
 * into individual columns and re-assembled in the mapper below.
 * pickupSavedLocationId is deliberately absent: that field links to a
 * saved location record by UUID, which a CSV row has no way to
 * meaningfully reference — every CSV-imported order gets a manually
 * geocoded pickup, never a saved-location link.
 */
export class CsvOrderRowDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  customerName: string;

  @IsString()
  @MaxLength(32)
  customerPhone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  customerEmail?: string;

  @IsString()
  @MaxLength(255)
  pickupLabel: string;

  @IsString()
  @MaxLength(500)
  pickupAddress: string;

  @Type(() => Number)
  pickupLat: number;

  @Type(() => Number)
  pickupLng: number;

  @IsString()
  @MaxLength(255)
  dropoffLabel: string;

  @IsString()
  @MaxLength(500)
  dropoffAddress: string;

  @Type(() => Number)
  dropoffLat: number;

  @Type(() => Number)
  dropoffLng: number;

  /** Format: "Item name:quantity|Item name:quantity" — e.g. "Jollof rice:2|Water:3". Parsed and validated separately in csv-order-row.util.ts, not via class-validator decorators, since nested-array parsing from a delimited string doesn't fit that pattern cleanly. */
  @IsString()
  items: string;

  @IsOptional()
  @IsEnum(OrderPriority)
  priority?: OrderPriority;

  @IsOptional()
  @IsString()
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
