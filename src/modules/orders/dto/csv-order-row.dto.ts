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
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CsvOrderRowDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-'.]+$/u,
    message: 'Customer name contains invalid characters',
  })
  customerName: string;

  @IsString()
  @MaxLength(32)
  @NoSpecialChars({
    pattern: /^[\d\s\-+()]+$/,
    message: 'Phone number contains invalid characters',
  })
  customerPhone: string;

  @IsEmail()
  @MaxLength(100)
  customerEmail: string;

  @IsString()
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\-_ ]+$/,
    message:
      'Pickup label can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  pickupLabel: string;

  @IsString()
  @MaxLength(500)
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Pickup address contains invalid characters',
  })
  pickupAddress: string;

  @Type(() => Number)
  pickupLat: number;

  @Type(() => Number)
  pickupLng: number;

  @IsString()
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\-_ ]+$/,
    message:
      'Dropoff label can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  dropoffLabel: string;

  @IsString()
  @MaxLength(500)
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Dropoff address contains invalid characters',
  })
  dropoffAddress: string;

  @Type(() => Number)
  dropoffLat: number;

  @Type(() => Number)
  dropoffLng: number;

  // Format: "Item name:quantity|Item name:quantity"
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Items field contains invalid characters',
  })
  items: string;

  @IsOptional()
  @IsEnum(OrderPriority)
  priority?: OrderPriority;

  @IsOptional()
  @IsString()
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Notes contain invalid characters',
  })
  notes?: string;
}
