import { IsEmail, IsEnum } from 'class-validator';
import { AdminRole } from '#/common/constants/admin-role.constant';

export class InviteAdminDto {
  @IsEmail()
  email: string;

  @IsEnum(AdminRole)
  role: AdminRole;
}