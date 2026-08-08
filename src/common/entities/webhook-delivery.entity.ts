import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WebhookEndpoint } from './webhook-endpoint.entity';
import { WebhookEventType } from '#/common/constants/webhook-event.constant';
import { WebhookDeliveryStatus } from '#/common/constants/webhook-delivery-status.constant';

@Entity('webhook_deliveries')
// Composite index for per-endpoint delivery listings
@Index(['webhookEndpointId', 'createdAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'webhook_endpoint_id', type: 'uuid' })
  webhookEndpointId: string;

  @ManyToOne(() => WebhookEndpoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'webhook_endpoint_id' })
  webhookEndpoint: WebhookEndpoint;

  @Column({ name: 'event_id', type: 'uuid' })
  @Index()
  eventId: string;

  @Column({ name: 'event_type', type: 'enum', enum: WebhookEventType })
  eventType: WebhookEventType;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  attemptNumber: number;

  @Column({ name: 'http_status_code', type: 'int', nullable: true })
  httpStatusCode: number | null;

  @Column({
    name: 'response_body',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  responseBody: string | null;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  errorMessage: string | null;

  // Simple index for cleanup service (WHERE createdAt < cutoff)
  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;
}