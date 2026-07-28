import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { UsersModule } from "#/modules/users/users.module";
import { DriverPresenceService } from "./driver-presence.service";
import { DriverPresenceGateway } from "./driver-presence.gateway";
import { HasActiveStopsService } from "./has-active-stops.service";

@Module({
    imports: [TypeOrmModule.forFeature([TripStop]), UsersModule],
    providers: [
        DriverPresenceService,
        DriverPresenceGateway,
        HasActiveStopsService
    ],
    exports: [DriverPresenceService]
})
export class PresenceModule {}
