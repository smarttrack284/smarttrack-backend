import { IsString, MinLength } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class AcceptInviteDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(2)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-'.]+$/u,
    message: 'Full name contains invalid characters',
  })
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;
}
