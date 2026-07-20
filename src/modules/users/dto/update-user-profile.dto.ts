import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;
  //
  // @IsOptional()
  // @IsEmail()
  // email?: string;
}
