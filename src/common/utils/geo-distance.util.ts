const EARTH_RADIUS_METERS = 6_371_000;

export type GeoPoint = { lat: number; lng: number };

/** Great-circle distance between two points, in meters. Fine for short-range movement checks and rough ETA estimates — NOT a substitute for a real routed distance when road-accurate figures matter. */
export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function calculateHeading(
    from: GeoPoint,
    to: GeoPoint,
): number {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;

    const dLon = (to.lng - from.lng) * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);

    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) *
            Math.cos(lat2) *
            Math.cos(dLon);

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}