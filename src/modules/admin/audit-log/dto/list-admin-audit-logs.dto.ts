import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class ListAdminAuditLogsDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\s@._-]+$/,
    message: 'Search contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsUUID()
  adminUserId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  severity?: string;

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
