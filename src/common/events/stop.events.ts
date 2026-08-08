import { SkipReasonCode } from "#/common/constants/stop-status.constant";
import { ProofOfDeliveryMethod } from "#/common/entities/trip-stop.entity";

export const STOP_EVENTS = {
    ARRIVED: "stop.arrived",
    COMPLETED: "stop.completed",
    SKIPPED: "stop.skipped"
} as const;

export class StopArrivedEvent {
    constructor(
        public readonly companyId: string,
        public readonly orderReference: string,
        public readonly customerName: string,
        public readonly arrivedAt: Date | null
    ) {}
}
export class StopCompletedEvent {
    constructor(
        public readonly companyId: string,
        public readonly orderReference: string,
        public readonly customerName: string,
        public readonly podMethod: ProofOfDeliveryMethod | null,
        public readonly podPhotoUrl: string | null,
        public readonly podSignatureUrl: string | null,
        public readonly podNotes: string | null,
        public readonly podCapturedAt: Date | null
    ) {}
}
export class StopSkippedEvent {
    constructor(
        public readonly companyId: string,
        public readonly orderReference: string,
        public readonly customerName: string,
        public readonly reason: SkipReasonCode,
        public readonly notes?: string
    ) {}
}
