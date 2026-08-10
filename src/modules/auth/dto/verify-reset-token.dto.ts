import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class VerifyResetTokenDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  token: string;
}
