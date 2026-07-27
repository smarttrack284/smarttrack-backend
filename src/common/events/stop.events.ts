import { SkipReasonCode } from '#/common/constants/stop-status.constant';

export const STOP_EVENTS = {
  ARRIVED: 'stop.arrived',
  COMPLETED: 'stop.completed',
  SKIPPED: 'stop.skipped',
} as const;

export class StopArrivedEvent {
  constructor(
    public readonly companyId: string,
    public readonly orderReference: string,
    public readonly customerName: string,
  ) {}
}
export class StopCompletedEvent {
  constructor(
    public readonly companyId: string,
    public readonly orderReference: string,
    public readonly customerName: string,
  ) {}
}
export class StopSkippedEvent {
  constructor(
    public readonly companyId: string,
    public readonly orderReference: string,
    public readonly customerName: string,
    public readonly reason: SkipReasonCode,
  ) {}
}
