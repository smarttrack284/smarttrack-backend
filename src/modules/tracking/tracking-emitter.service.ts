import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Owns the Socket.IO Server reference. TrackingGateway sets it once on
 * init; TrackingService (and, via TrackingService, DispatchService) emit
 * through this instead of depending on the Gateway class directly — this
 * is what lets DispatchModule import TrackingModule without a circular
 * TrackingModule -> DispatchModule dependency back.
 */
@Injectable()
export class TrackingEmitterService {
  private readonly logger = new Logger(TrackingEmitterService.name);
  private server?: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToInternalRoom(tripId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn('Emit attempted before gateway initialized — dropped');
      return;
    }
    this.server.to(`trip:${tripId}:internal`).emit(event, payload);
  }

  emitToPublicRoom(
    trackingNumber: string,
    event: string,
    payload: unknown,
  ): void {
    if (!this.server) return;
    this.server.to(`tracking:${trackingNumber}`).emit(event, payload);
  }
}
