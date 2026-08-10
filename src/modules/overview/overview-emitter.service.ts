import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class OverviewEmitterService {
  private readonly logger = new Logger(OverviewEmitterService.name);
  private server?: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToCompany(companyId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn({msg: 'Emit attempted before gateway initialized — dropped'});
      return;
    }
    this.server.to(`overview:${companyId}`).emit(event, payload);
  }
}
