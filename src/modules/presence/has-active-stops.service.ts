import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { StopStatus } from "#/common/constants/stop-status.constant";

@Injectable()
export class HasActiveStopsService {
    private readonly logger = new Logger(HasActiveStopsService.name);

    constructor(
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>
    ) {}

    /**
     * Returns `true` if the driver has at least one pending or arrived stop.
     *
     * If the database query fails, the method logs the error and returns
     * `false` — the offline event will still fire, but without the extra
     * flag about active stops.  This is intentional: a transient database
     * outage should not suppress the entire offline event.
     */
    async check(driverUserId: string): Promise<boolean> {
        try {
            const count = await this.tripStopRepo
                .createQueryBuilder("stop")
                .innerJoin("stop.trip", "trip")
                .where("trip.driverUserId = :driverUserId", { driverUserId })
                .andWhere("stop.status IN (:...statuses)", {
                    statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
                })
                .getCount();

            return count > 0;
        } catch (err) {
            this.logger.error({
                msg: `Failed to check active stops for driver ${driverUserId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            // Safe fallback – treat as if no active stops so offline event still fires
            return false;
        }
    }
}
