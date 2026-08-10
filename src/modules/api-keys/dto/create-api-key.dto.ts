import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @NoSpecialChars({
    message:
      'API key name can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays: number | null;
}
