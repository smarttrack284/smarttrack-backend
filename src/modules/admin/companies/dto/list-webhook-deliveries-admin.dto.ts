import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Min, Max } from 'class-validator';
import { WebhookDeliveryStatus } from '#/common/constants/webhook-delivery-status.constant';

export class ListWebhookDeliveriesAdminDto {
  @IsOptional()
  @IsUUID()
  webhookEndpointId?: string;

  @IsOptional()
  @IsEnum(WebhookDeliveryStatus)
  status?: WebhookDeliveryStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
