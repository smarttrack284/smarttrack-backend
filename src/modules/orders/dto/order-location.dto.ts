import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class OrderLocationDto {
  @IsString()
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[a-zA-Z0-9\-_ ]+$/,
    message:
      'Location label can only contain letters, numbers, spaces, hyphens, and underscores',
  })
  label: string;

  @IsString()
  @MaxLength(500)
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Address contains invalid characters',
  })
  address: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}
