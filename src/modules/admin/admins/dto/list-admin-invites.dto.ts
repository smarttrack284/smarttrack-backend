import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export enum AdminInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  ALL = 'all',
}

export class ListAdminInvitesDto {
  @IsOptional()
  @IsEnum(AdminInviteStatus)
  status?: AdminInviteStatus = AdminInviteStatus.PENDING;

  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\s@._-]+$/,
    message: 'Search contains invalid characters',
  })
  search?: string;

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