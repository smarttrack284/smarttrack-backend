import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class SignUpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-'.]+$/u,
    message: 'Full name contains invalid characters',
  })
  fullName: string;
}
