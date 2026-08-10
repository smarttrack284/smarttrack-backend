import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { TeamRoleType } from '#/common/types/team-role.type';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export enum TeamSortKey {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  NAME_AZ = 'name_az',
}

export class ListTeamMembersQueryDto {
  @IsOptional()
  @IsString()
  @NoSpecialChars({
    pattern: /^[^<>`]+$/,
    message: 'Search query contains invalid characters',
  })
  search?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TeamRoleType, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  roles?: TeamRoleType[];

  @IsOptional()
  @IsEnum(TeamSortKey)
  sort?: TeamSortKey = TeamSortKey.NEWEST;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
