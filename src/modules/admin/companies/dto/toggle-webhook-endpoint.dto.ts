import { IsBoolean, IsOptional } from 'class-validator';

export class ToggleWebhookEndpointDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
