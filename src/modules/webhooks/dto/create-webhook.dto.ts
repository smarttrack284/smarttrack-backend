import { ArrayMinSize, IsArray, IsEnum, IsString, IsUrl, MaxLength, } from 'class-validator';
import { WebhookEventType } from '#/common/constants/webhook-event.constant';

export class CreateWebhookDto {
  @IsString()
  @MaxLength(100)
  description: string;

  @IsUrl()
  @IsString()
  @MaxLength(500)
  url: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(WebhookEventType, { each: true })
  events: WebhookEventType[];
}
