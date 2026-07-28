import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TripStop } from "#/common/entities/trip-stop.entity";
import { StopStatus } from "#/common/constants/stop-status.constant";

@Injectable()
export class HasActiveStopsService {
    constructor(
        @InjectRepository(TripStop)
        private readonly tripStopRepo: Repository<TripStop>
    ) {}

    /** Used to flag whether a driver going offline is operationally significant (they still had unresolved stops) vs. routine (their shift ended normally). */
    async check(driverUserId: string): Promise<boolean> {
        const count = await this.tripStopRepo
            .createQueryBuilder("stop")
            .innerJoin("stop.trip", "trip")
            .where("trip.driverUserId = :driverUserId", { driverUserId })
            .andWhere("stop.status IN (:...statuses)", {
                statuses: [StopStatus.PENDING, StopStatus.ARRIVED]
            })
            .getCount();
        return count > 0;
    }
}
