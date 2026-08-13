import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Min, Max } from "class-validator";
import { SubscriptionPlan } from "#/common/constants/subscription-plan.constant";
import { SubscriptionStatus } from "#/common/constants/subscription-plan.constant";
import { NoSpecialChars } from "#/common/validators/no-special-chars.validator";

export enum CompanySort {
    NEWEST = "newest",
    OLDEST = "oldest",
    NAME_AZ = "name_az",
    NAME_ZA = "name_za"
}

export class ListCompaniesDto {
    @IsOptional()
    @IsString()
    @NoSpecialChars({
        // Allow letters, digits, spaces, @, dot, hyphen, underscore – no angle brackets or backticks
        pattern: /^[a-zA-Z0-9\s@._-]+$/,
        message: "Search contains invalid characters"
    })
    search?: string;

    @IsOptional()
    @IsEnum(SubscriptionPlan)
    plan?: SubscriptionPlan;

    @IsOptional()
    @IsEnum(SubscriptionStatus)
    status?: SubscriptionStatus;

    @IsOptional()
    @IsEnum(CompanySort)
    sort?: CompanySort = CompanySort.NEWEST;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize?: number = 20;
}
