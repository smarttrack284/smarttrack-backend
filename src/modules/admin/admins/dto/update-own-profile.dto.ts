import { IsOptional, IsPhoneNumber, IsString } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-'.]+$/u,
    message: 'Name contains invalid characters',
  })
  name?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;
}