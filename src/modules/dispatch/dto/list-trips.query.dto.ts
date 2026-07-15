import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TripStatus } from '#/common/constants/trip-status.constant';

export class ListTripsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  /** Filtered in-memory after deriving each trip's status — trip volume per company is small enough at MVP scale that this doesn't need a SQL-level computed-column filter. Revisit if trip lists grow large. */
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