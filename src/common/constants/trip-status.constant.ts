/** Always derived from a trip's stops, never stored — mirrors the frontend's getTripStatus, so there's no column that could drift out of sync with reality. */
export enum TripStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}