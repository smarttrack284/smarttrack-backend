import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { WebhookEventType } from '#/common/constants/webhook-event.constant';

@Entity('webhook_endpoints')
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  @Index()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 100 })
  description: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  /** AES-256-GCM encrypted, NOT hashed — signing a delivery requires the plaintext, unlike an API key which only ever needs comparison. See webhook-secret.util.ts. */
  @Column({ name: 'secret_encrypted', type: 'varchar', length: 500 })
  secretEncrypted: string;

  @Column({ type: 'enum', enum: WebhookEventType, array: true })
  events: WebhookEventType[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
