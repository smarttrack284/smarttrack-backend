import {
    ConnectedSocket,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer
} from "@nestjs/websockets";
import type { Server } from "socket.io";
import { SupabaseJwtVerifierService } from "#/common/auth/supabase-jwt-verifier.service";
import { UsersService } from "#/modules/users/users.service";
import { TeamRoleType } from "#/common/types/team-role.type";
import type { AuthenticatedSocket } from "#/common/types/authenticated-socket.type";
import { DriverPresenceService } from "./driver-presence.service";
import { HasActiveStopsService } from "./has-active-stops.service";

type DriverSocket = AuthenticatedSocket & {
    data: { user?: any; companyId?: string; driverName?: string };
};

/**
 * A driver's mobile app connects here for the lifetime of their shift —
 * connection = online, disconnect (past the grace period) = offline.
 * Distinct namespace from `tracking`, since presence is a different
 * concern from live location broadcasting, even though both are
 * driver-app-facing.
 */
@WebSocketGateway({
    namespace: "driver-presence",
    cors: { origin: process.env.CLIENT_URL ?? true, credentials: true }
})
export class DriverPresenceGateway implements OnGatewayInit {
    @WebSocketServer()
    server: Server;

    constructor(
        private readonly presenceService: DriverPresenceService,
        private readonly verifier: SupabaseJwtVerifierService,
        private readonly usersService: UsersService,
        private readonly hasActiveStopsService: HasActiveStopsService
    ) {}

    afterInit(): void {}

    /** Unlike TrackingGateway, a missing/invalid token here always disconnects — this namespace has no legitimate anonymous/public use case the way tracking-by-number does. */
    async handleConnection(socket: DriverSocket): Promise<void> {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) {
            socket.disconnect(true);
            return;
        }

        try {
            const user = await this.verifier.verify(token);
            const userRole = await this.usersService.getUserRoleByUserId(
                user.id
            );

            if (userRole.role !== TeamRoleType.DRIVER) {
                socket.disconnect(true); // presence is a driver-only concept — a dispatcher's own connection shouldn't register as "a driver went online"
                return;
            }

            socket.data.user = user;
            socket.data.companyId = userRole.companyId;
            socket.data.driverName = userRole.name ?? user.email;

            await this.presenceService.setOnline(
                userRole.companyId,
                user.id,
                socket.data.driverName
            );
        } catch {
            socket.disconnect(true);
        }
    }

    handleDisconnect(socket: DriverSocket): void {
        if (!socket.data.user || !socket.data.companyId) return;

        this.presenceService.scheduleOffline(
            socket.data.companyId,
            socket.data.user.id,
            socket.data.driverName ?? socket.data.user.email,
            () => this.hasActiveStopsService.check(socket.data.user.id)
        );
    }

    /** Driver app calls this periodically (e.g. every 30s) to keep the TTL fresh — a distinct signal from connect/disconnect, since a long-lived socket connection alone shouldn't be assumed healthy without confirmation. */
    @SubscribeMessage("heartbeat")
    async handleHeartbeat(@ConnectedSocket() socket: DriverSocket) {
        if (!socket.data.user || !socket.data.companyId) return;
        await this.presenceService.heartbeat(
            socket.data.companyId,
            socket.data.user.id
        );
    }
}
