import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCompanyDto {
  // @IsNotEmpty()
  // @IsUUID()
  // ownerUserId: string;
  //
  // @IsString()
  // @IsNotEmpty()
  // @MinLength(2)
  // @MaxLength(255)
  // ownerName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone: string;
}
