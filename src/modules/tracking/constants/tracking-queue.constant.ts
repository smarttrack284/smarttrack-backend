export const TRACKING_QUEUE_NAME = 'tracking-broadcast';

export enum TrackingJobName {
  BROADCAST_TRIP_UPDATE = 'broadcast-trip-update',
}

export type BroadcastTripUpdateJobData = {
  tripId: string;
};