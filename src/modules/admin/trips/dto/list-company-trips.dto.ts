import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';
import { TripStatus } from '#/common/constants/trip-status.constant';

export enum TripSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
}

export class ListCompanyTripsDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\s@._:-]+$/,
    message: 'Search contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @IsOptional()
  @IsUUID()
  driverUserId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsEnum(TripSort)
  sort?: TripSort = TripSort.NEWEST;

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
