import { IsEmail } from 'class-validator';

export class ResendAdminInviteDto {
  @IsEmail()
  email: string;
}