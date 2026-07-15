import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '#/common/constants/order-status.constant';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
