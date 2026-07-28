import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiKeyGuard } from '#/common/guards/api-key.guard';
import { TeamService } from './team.service';

/**
 * Deliberately the SMALLEST external surface of the four modules —
 * inviting, removing, or changing a team member's role via a machine
 * credential is a real security risk (an external system shouldn't be
 * able to alter who has access to the workspace). Read-only visibility
 * into available drivers is the one legitimate integration use case:
 * an external dispatch/logistics tool checking driver capacity.
 */
@UseGuards(ApiKeyGuard)
@Controller('external/team')
export class TeamExternalController {
  constructor(private readonly teamService: TeamService) {}

  @Get('drivers/available')
  async listAvailableDrivers(@Req() request: FastifyRequest) {
    const companyId = request.apiKeyCompanyId!;
    return this.teamService.listAvailableDriversForCompany(companyId);
  }
}