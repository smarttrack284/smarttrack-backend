import { StopStatus } from "#/common/constants/stop-status.constant";
import type { Trip } from "#/common/entities/trip.entity";

export type TripActivityEvent = {
    id: string;
    message: string;
    timestamp: string;
};

/**
 * Derives the activity timeline from facts already on Trip/TripStop —
 * deliberately NOT a separate stored log. Every fact this needs already
 * has one authoritative source (trip.createdAt, trip.startedAt,
 * stop.arrivedAt, stop.completedAt, stop.skipReason); storing a second,
 * separate "activity log" table would create two places the same fact
 * could drift out of sync (e.g. a stop's completedAt changing without a
 * matching activity row being written). This is computed fresh every
 * time, same pattern as deriveTripStatus/getTripProgress.
 */
export function deriveTripActivity(trip: Trip): TripActivityEvent[] {
    const events: TripActivityEvent[] = [
        {
            id: `${trip.id}-created`,
            message: "Trip created",
            timestamp: trip.createdAt.toISOString()
        }
    ];

    if (trip.startedAt) {
        events.push({
            id: `${trip.id}-started`,
            message: "Driver started the trip",
            timestamp: trip.startedAt.toISOString()
        });
    }

    for (const stop of trip.stops) {
        if (stop.arrivedAt) {
            events.push({
                id: `${stop.id}-arrived`,
                message: `Arrived — ${stop.order.customerName} (${stop.order.orderReference})`,
                timestamp: stop.arrivedAt.toISOString()
            });
        }

        if (stop.status === StopStatus.COMPLETED && stop.completedAt) {
            events.push({
                id: `${stop.id}-completed`,
                message: `Delivered — ${stop.order.customerName} (${stop.order.orderReference})`,
                timestamp: stop.completedAt.toISOString()
            });
        }

        if (stop.status === StopStatus.SKIPPED) {
            events.push({
                id: `${stop.id}-skipped`,
                message: `Skipped — ${stop.order.customerName} (${
                    stop.order.orderReference
                })${stop.skipReason ? `: ${stop.skipReason}` : ""}`,
                // Skip has no dedicated timestamp column — updatedAt is the closest
                // real fact available at the moment the skip was recorded.
                timestamp: stop.updatedAt.toISOString()
            });
        }
    }

    return events.sort(
        (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
}
