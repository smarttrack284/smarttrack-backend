import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  emailOrderCreated?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOrderAssined?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOrderPickedUp?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOrderDelivered?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOrderFailed?: boolean;

  @IsOptional()
  @IsBoolean()
  emailOrderCancelled?: boolean;
}
