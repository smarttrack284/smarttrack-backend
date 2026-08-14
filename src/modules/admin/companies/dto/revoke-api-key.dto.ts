import { IsUUID } from 'class-validator';

export class RevokeApiKeyDto {
  @IsUUID()
  apiKeyId: string;
}
