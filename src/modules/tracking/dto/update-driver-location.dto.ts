import { IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateDriverLocationDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  /** From the device's GPS API — used to reject unreliable fixes rather than trusting every reported point blindly. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracyMeters?: number;

  /** When the device actually captured this fix, not when it arrived — matters for stale/out-of-order detection over flaky mobile networks. */
  @IsOptional()
  @IsISO8601()
  clientTimestamp?: string;
}