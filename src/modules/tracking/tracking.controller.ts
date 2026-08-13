import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { TrackingService } from './tracking.service';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';
import { Roles } from '#/common/decorators/roles.decorator';
import { RolesGuard } from '#/common/guards/roles.guard';
import { TeamRoleType } from '#/common/types/team-role.type';
import { PublicThrottle } from '#/common/decorators/throttle.decorator';

@Controller('dispatch/trips')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@PublicThrottle()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post(':tripId/location')
  @Roles(TeamRoleType.DRIVER)
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: UpdateDriverLocationDto,
  ) {
    return this.trackingService.updateDriverLocation(tripId, user.id, dto);
  }
}
