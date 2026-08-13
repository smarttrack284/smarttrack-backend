import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { ActivityCategory } from '#/common/constants/activity-log.constant';
import { ActivitySeverity } from '#/common/constants/activity-log.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class ListActivityLogAdminDto {
  @IsOptional()
  @IsArray()
  @IsEnum(ActivityCategory, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  categories?: ActivityCategory[];

  @IsOptional()
  @IsArray()
  @IsEnum(ActivitySeverity, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  severities?: ActivitySeverity[];

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Search query contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
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
  @Max(100)
  pageSize?: number = 20;
}