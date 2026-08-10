import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, } from 'class-validator';
import { OrderStatus } from '#/common/constants/order-status.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export enum SortOrder {
  NEWEST = 'newest',
  OLDEST = 'oldest',
}

export class ListOrdersQueryDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Search query contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsEnum(SortOrder)
  sort?: SortOrder;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
