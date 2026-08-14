import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AdminRole } from '#/common/constants/admin-role.constant';

export class UpdateAdminDto {
  @IsOptional()
  @IsEnum(AdminRole)
  role?: AdminRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}