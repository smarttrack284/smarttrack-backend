import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SavedLocationKind } from '#/common/entities/saved-location.entity';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CreateSavedLocationDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @NoSpecialChars({
    message:
      'Label can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  label: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  @NoSpecialChars({
    // Allow common address characters: letters, numbers, spaces, commas, periods, hyphens, #, /, ', &
    pattern: /^[\p{L}0-9\s,.\-/#&']+$/u,
    message: 'Address contains invalid characters',
  })
  address: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsEnum(SavedLocationKind)
  kind: SavedLocationKind;
}
