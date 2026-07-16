import { IsLatitude, IsLongitude } from 'class-validator';

export class UpdateDriverLocationDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}
