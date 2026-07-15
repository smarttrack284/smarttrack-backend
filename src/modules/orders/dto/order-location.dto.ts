import { IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';

export class OrderLocationDto {
  @IsString()
  @MaxLength(255)
  label: string;

  @IsString()
  @MaxLength(500)
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
