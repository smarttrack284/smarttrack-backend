import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProofOfDeliveryMethod } from '#/common/entities/trip-stop.entity';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class CompleteStopDto {
  @IsEnum(ProofOfDeliveryMethod)
  podMethod: ProofOfDeliveryMethod;

  /**
   * The name of the person who received the delivery.
   * Allows Unicode letters, spaces, hyphens, apostrophes, and periods.
   * Blocks angle brackets and other risky characters.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-'.]+$/u,
    message: 'Recipient name contains invalid characters',
  })
  recipientName?: string;

  /**
   * Free‑form notes (e.g. “Left at the back door”).
   * Allows any printable character EXCEPT angle brackets and backticks.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Notes contain invalid characters',
  })
  notes?: string;
}
