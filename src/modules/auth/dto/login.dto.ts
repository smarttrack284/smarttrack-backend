import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    MinLength,
    Validate
} from "class-validator";
import { IsStrongPassword } from "#/common/decorators/validate-password.decorator";

export class LogInDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsStrongPassword()
    password: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    captchaToken: string;

    @IsOptional()
    @IsString()
    @MinLength(2)
    website?: string;
}
