import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TripStatus } from '#/common/constants/trip-status.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class ListTripsQueryDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    // Allow any text except angle brackets and backticks – blocks script injection
    pattern: /^[^<>`]+$/,
    message: 'Search query contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

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
