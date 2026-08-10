import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsPhoneNumber,
} from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-'.]+$/u,
    message: 'Name contains invalid characters',
  })
  name?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;
}
