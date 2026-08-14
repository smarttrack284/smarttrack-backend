import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AdminRole } from '#/common/constants/admin-role.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class ListAdminsDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\s@._-]+$/,
    message: 'Search contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsEnum(AdminRole)
  role?: AdminRole;

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