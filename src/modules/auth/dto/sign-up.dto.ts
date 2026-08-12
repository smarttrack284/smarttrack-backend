import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    MinLength,
    Validate,
} from "class-validator";
import { NoSpecialChars } from "#/common/validators/no-special-chars.validator";
import { IsStrongPassword } from "#/common/decorators/validate-password.decorator";

export class SignUpDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsStrongPassword()
    password: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    @NoSpecialChars({
        pattern: /^[\p{L}0-9\s\-'.]+$/u,
        message: "Full name contains invalid characters"
    })
    fullName: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(2)
    captchaToken: string;

    @IsOptional()
    @IsString()
    @MinLength(2)
    website?: string;
}
