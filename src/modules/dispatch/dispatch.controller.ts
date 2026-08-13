import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { DispatchService } from './dispatch.service';
import { DispatchOrdersDto } from './dto/dispatch-orders.dto';
import { SkipStopDto } from './dto/skip-stop.dto';
import { CompleteStopDto } from './dto/complete-stop.dto';
import { ListTripsQueryDto } from './dto/list-trips.query.dto';
import { FileValidationPipe } from '#/common/pipes/file-validation.pipe';
import type { FastifyRequest } from 'fastify';
import { Roles } from '#/common/decorators/roles.decorator';
import { RolesGuard } from '#/common/guards/roles.guard';
import { TeamRoleType } from '#/common/types/team-role.type';
import {
  PublicThrottle,
  UploadThrottle,
} from '#/common/decorators/throttle.decorator';

@Controller('dispatch/trips')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@PublicThrottle()
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post()
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async dispatchOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DispatchOrdersDto,
  ) {
    await this.dispatchService.dispatchOrdersToDriver(
      user.companyId!,
      user.id,
      dto,
    );
    return { success: true };
  }

  @Get()
  @Roles(TeamRoleType.OWNER, TeamRoleType.ADMIN, TeamRoleType.DISPATCHER)
  async listTrips(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTripsQueryDto,
  ) {
    return this.dispatchService.listTripsForCompanyWithDriverNames(
      user.companyId!,
      query,
    );
  }

  @Get(':tripId')
  @Roles(
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN,
    TeamRoleType.DISPATCHER,
    TeamRoleType.DRIVER,
  )
  async findTrip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ) {
    const trip = await this.dispatchService.getTripForCompany(
      tripId,
      user.companyId!,
    );
    const drivers = await this.dispatchService.getDriversForTrips(
      user.companyId!,
      [trip],
    );
    return this.dispatchService.toTripResponse(
      trip,
      drivers.get(trip.driverUserId) ?? null,
    );
  }

  @Patch(':tripId/stops/:stopId/arrive')
  @Roles(
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN,
    TeamRoleType.DISPATCHER,
    TeamRoleType.DRIVER,
  )
  async arriveStop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
  ) {
    return this.dispatchService.arriveAtStop(
      tripId,
      stopId,
      user.companyId!,
      user.id,
    );
  }

  @Post(':tripId/stops/:stopId/complete')
  @UploadThrottle()
  @Roles(
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN,
    TeamRoleType.DISPATCHER,
    TeamRoleType.DRIVER,
  )
  async completeStop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Req() request: FastifyRequest,
  ) {
    const parts = request.parts();
    let dto: Partial<CompleteStopDto> = {};
    const files: {
      photo?: { buffer: Buffer; contentType: string; extension: string };
      signature?: {
        buffer: Buffer;
        contentType: string;
        extension: string;
      };
    } = {};

    for await (const part of parts) {
      if (
        part.type === 'file' &&
        (part.fieldname === 'photo' || part.fieldname === 'signature')
      ) {
        const buffer = await part.toBuffer();
        const validated = new FileValidationPipe({
          allowedMimeTypes: new Set(['image/png', 'image/jpeg', 'image/webp']),
          maxSizeBytes: 5 * 1024 * 1024,
        }).transform({
          file: part,
          buffer,
        });
        const extension = validated.file.filename.split('.').pop() ?? 'jpg';
        files[part.fieldname as 'photo' | 'signature'] = {
          buffer: validated.buffer,
          contentType: validated.file.mimetype,
          extension,
        };
      } else if (part.type === 'field') {
        (dto as Record<string, unknown>)[part.fieldname] = part.value;
      }
    }

    return this.dispatchService.completeStop(
      tripId,
      stopId,
      user.companyId!,
      user.id,
      dto as CompleteStopDto,
      files,
    );
  }

  @Patch(':tripId/stops/:stopId/skip')
  @Roles(
    TeamRoleType.OWNER,
    TeamRoleType.ADMIN,
    TeamRoleType.DISPATCHER,
    TeamRoleType.DRIVER,
  )
  async skipStop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: SkipStopDto,
  ) {
    return this.dispatchService.skipStop(
      tripId,
      stopId,
      user.companyId!,
      user.id,
      dto,
    );
  }
}
