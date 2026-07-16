import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;
}
