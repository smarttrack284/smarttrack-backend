import { ArrayMinSize, IsArray, IsEnum, IsString, IsUrl, MaxLength, } from 'class-validator';
import { WebhookEventType } from '#/common/constants/webhook-event.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CreateWebhookDto {
  @IsString()
  @MaxLength(100)
  @NoSpecialChars({
    message:
      'Description can only contain letters, numbers, spaces, hyphens, and underscores',
  })
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
