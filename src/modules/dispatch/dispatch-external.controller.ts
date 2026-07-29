import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiKeyGuard } from '#/common/guards/api-key.guard';
import { DispatchService } from './dispatch.service';

/**
 * Read-only, same reasoning as Team's external surface — dispatching
 * order, marking stops arrived/completed/skipped are all actions with
 * real physical-world consequences and proof-of-delivery requirements;
 * none of that belongs behind a machine credential with no human
 * confirming it happened. External callers can check trip status, not
 * drive it.
 */
@UseGuards(ApiKeyGuard)
@Controller('external/dispatch/trips')
export class DispatchExternalController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get(':id')
  async findOne(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const companyId = request.apiKeyCompanyId!;
    const trip = await this.dispatchService.getTripForCompany(id, companyId);
    return this.dispatchService.toTripResponse(trip);
  }
}
