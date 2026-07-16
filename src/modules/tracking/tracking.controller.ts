import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { TrackingService } from './tracking.service';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('dispatch/trips')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  /**
   * Rate-limited to roughly one update per 3 seconds per client — a
   * driver's GPS has no business posting faster than that, and this
   * protects both this server and the fan-out to every connected
   * dispatcher/customer socket from being overwhelmed by a runaway client.
   *
   * NOTE: @nestjs/throttler's default storage is in-memory, PER INSTANCE —
   * across multiple server instances this limit isn't actually shared,
   * same caveat as BullMQ's rate limiter needing real tuning. A Redis-backed
   * throttler storage is the fix if you scale beyond one instance and this
   * matters precisely.
   */
  @Throttle({ default: { limit: 1, ttl: 3000 } })
  @Post(':tripId/location')
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: UpdateDriverLocationDto,
  ) {
    await this.trackingService.updateDriverLocation(tripId, user.id, dto);
    return { success: true };
  }
}
