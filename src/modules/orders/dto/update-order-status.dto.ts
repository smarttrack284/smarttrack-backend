import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '#/common/constants/order-status.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Reason contains invalid characters',
  })
  reason?: string;
}
