import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderPriority } from '#/common/constants/order-status.constant';
import { OrderLocationDto } from './order-location.dto';
import { OrderItemDto } from './order-item.dto';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CreateOrderDto {
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
    pattern: /^[\d\s\-\+\(\)]+$/,
    message: 'Phone number contains invalid characters',
  })
  customerPhone: string;

  @IsEmail()
  @MaxLength(100)
  customerEmail: string;

  @ValidateNested()
  @Type(() => OrderLocationDto)
  pickupLocation: OrderLocationDto;

  @IsOptional()
  @IsUUID()
  pickupSavedLocationId?: string;

  @ValidateNested()
  @Type(() => OrderLocationDto)
  dropoffLocation: OrderLocationDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsEnum(OrderPriority)
  priority?: OrderPriority;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Notes contain invalid characters',
  })
  notes?: string;
}
