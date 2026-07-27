export enum WebhookEventType {
  ORDER_CREATED = 'order.created',
  ORDER_STATUS_CHANGED = 'order.status_changed',
  ORDER_DELIVERED = 'order.delivered',
  ORDER_FAILED = 'order.failed',
  STOP_ARRIVED = 'stop.arrived',
  STOP_COMPLETED = 'stop.completed',
  STOP_SKIPPED = 'stop.skipped',
  TEAM_MEMBER_ACCEPTED = 'team.member_accepted',
}
