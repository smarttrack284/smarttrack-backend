import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SkipReasonCode } from '#/common/constants/stop-status.constant';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class SkipStopDto {
  @IsEnum(SkipReasonCode)
  reason: SkipReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @NoSpecialChars({
    // Allow any printable character except angle brackets and backticks –
    // blocks script injection while keeping the note field fully usable
    // for real-world text (commas, apostrophes, exclamation marks, etc.).
    pattern: /^[^<>`]+$/,
    message: 'Skip note contains invalid characters',
  })
  note?: string;
}
