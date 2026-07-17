import { haversineDistanceMeters, type GeoPoint } from './geo-distance.util';

/** Conservative average urban delivery speed. This is a STRAIGHT-LINE estimate, not a routed one — if you later want a real routed ETA (Radar's Directions API), that network call must happen inside the queue job, never in the low-latency ingest path, since it has its own latency and rate limit. */
const AVERAGE_SPEED_KPH = 25;

export function estimateEtaMinutes(from: GeoPoint, to: GeoPoint): number {
  const distanceKm = haversineDistanceMeters(from, to) / 1000;
  const hours = distanceKm / AVERAGE_SPEED_KPH;
  return Math.max(1, Math.round(hours * 60));
}