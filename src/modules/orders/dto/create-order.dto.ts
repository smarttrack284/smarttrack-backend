import { Type } from "class-transformer";
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
    ValidateNested
} from "class-validator";
import { OrderPriority } from "#/common/constants/order-status.constant";
import { OrderLocationDto } from "./order-location.dto";
import { OrderItemDto } from "./order-item.dto";

export class CreateOrderDto {
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
    notes?: string;
}
