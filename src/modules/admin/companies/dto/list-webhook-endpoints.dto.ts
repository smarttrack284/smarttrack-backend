import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class ListWebhookEndpointsDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\s@._:/?&=-]+$/,
    message: 'Search contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}