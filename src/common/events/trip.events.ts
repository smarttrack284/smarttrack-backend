export const TRIP_EVENTS = {
  UPDATED: 'trip.updated',
} as const;

export class TripUpdatedEvent {
  constructor(public readonly companyId: string) {}
}
