export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';
export enum WebhookJobName {
  DELIVER = 'deliver',
}
export type DeliverWebhookJobData = {
  webhookEndpointId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptNumber: number;
};
