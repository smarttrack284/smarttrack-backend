import {
    IsString,
    IsOptional,
    IsNotEmpty,
    MaxLength,
    IsEnum,
    IsLatitude,
    IsLongitude
} from "class-validator";
import { SavedLocationKind } from "#/common/entities/saved-location.entity";

export class CreateSavedLocationDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(255)
    label: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(255)
    address: string;

    @IsLatitude()
    lat: number;

    @IsLongitude()
    lng: number;

    @IsOptional()
    @IsEnum(SavedLocationKind)
    kind: SavedLocationKind;
}
