import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class OrdersEmitterService {
  private readonly logger = new Logger(OrdersEmitterService.name);
  private server?: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToSocket(socketId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn({msg: 'Emit attempted before gateway initialized — dropped'});
      return;
    }
    this.server.to(socketId).emit(event, payload); // Socket.IO treats a socket's own id as an implicit single-member room
  }
}