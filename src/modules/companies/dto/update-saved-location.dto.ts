import { CreateSavedLocationDto } from "./create-saved-location.dto";
import { PartialType } from "@nestjs/mapped-types";
export class UpdateSavedLocationDto extends PartialType(
    CreateSavedLocationDto
) {}
