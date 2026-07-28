export const DRIVER_PRESENCE_EVENTS = {
    ONLINE: "driver_presence.online",
    OFFLINE: "driver_presence.offline"
} as const;

export class DriverOnlineEvent {
    constructor(
        public readonly companyId: string,
        public readonly driverUserId: string,
        public readonly driverName: string
    ) {}
}
export class DriverOfflineEvent {
    constructor(
        public readonly companyId: string,
        public readonly driverUserId: string,
        public readonly driverName: string,
        public readonly hadActiveStops: boolean
    ) {}
}
