import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  captchaToken: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  website?: string;
}
