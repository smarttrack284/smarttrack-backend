import { StopStatus } from '#/common/constants/stop-status.constant';
import { TripStatus } from '#/common/constants/trip-status.constant';
import type { TripStop } from '#/common/entities/trip-stop.entity';

const RESOLVED_STATUSES = new Set<StopStatus>([StopStatus.COMPLETED, StopStatus.SKIPPED, StopStatus.FAILED]);

export function deriveTripStatus(stops: TripStop[]): TripStatus {
  const hasStarted = stops.some((s) => s.status !== StopStatus.PENDING);
  const allResolved = stops.every((s) => RESOLVED_STATUSES.has(s.status));
  if (allResolved) return TripStatus.COMPLETED;
  if (hasStarted) return TripStatus.IN_PROGRESS;
  return TripStatus.SCHEDULED;
}

export function getTripProgress(stops: TripStop[]) {
  const total = stops.length;
  const completed = stops.filter((s) => s.status === StopStatus.COMPLETED).length;
  const skipped = stops.filter((s) => s.status === StopStatus.SKIPPED).length;
  const failed = stops.filter((s) => s.status === StopStatus.FAILED).length;
  const resolved = completed + skipped + failed;
  return { total, completed, skipped, failed, resolved, percent: total ? Math.round((resolved / total) * 100) : 0 };
}

/** The stop a dispatcher/driver should currently focus on — first unresolved stop in sequence. */
export function getCurrentStop(stops: TripStop[]): TripStop | null {
  return stops.find((s) => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED) ?? null;
}