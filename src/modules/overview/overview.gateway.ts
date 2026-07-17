import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import { UsersService } from '#/modules/users/users.service';
import type { AuthenticatedSocket } from '#/common/types/authenticated-socket.type';
import { OverviewEmitterService } from './overview-emitter.service';
import { OverviewService } from './overview.service';

@WebSocketGateway({
  namespace: 'overview',
  cors: { origin: process.env.CLIENT_URL ?? true, credentials: true },
})
export class OverviewGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly emitter: OverviewEmitterService,
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly usersService: UsersService,
    private readonly overviewService: OverviewService,
  ) {}

  afterInit(server: Server): void {
    this.emitter.setServer(server);
  }

  /**
   * The Overview page has nothing to subscribe to but "my own company" —
   * there's no per-trip/per-order choice to make, so this room is joined
   * automatically at connection time, derived entirely from the verified
   * token. No client-supplied companyId is ever trusted or even accepted.
   */
  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const user = await this.verifier.verify(token);
      const userRole = await this.usersService.getUserRoleByUserId(user.id);
      await socket.join(`overview:${userRole.companyId}`);

      // Immediate snapshot on connect, same as TrackingGateway's subscribe handler.
      const [kpis, activity, recentOrders] = await Promise.all([
        this.overviewService.getKpis(userRole.companyId),
        this.overviewService.getRecentActivity(userRole.companyId),
        this.overviewService.getRecentOrders(userRole.companyId),
      ]);
      socket.emit('overview:update', { kpis, activity, recentOrders });
    } catch {
      socket.disconnect(true);
    }
  }
}
