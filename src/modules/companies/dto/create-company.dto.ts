import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength, } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-&.,'()]+$/u,
    message: 'Company name contains invalid characters',
  })
  name: string;

  @IsEmail()
  @MaxLength(100)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone: string;
}
