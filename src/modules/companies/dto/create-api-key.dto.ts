import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class CreateApiKeyDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(255)
    name: string;
}
