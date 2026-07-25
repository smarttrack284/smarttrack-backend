import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { OrderItem } from './order-item.entity';
import { OrderLocationEmbed } from './order-location.embeddable';
import {
  OrderPriority,
  OrderStatus,
} from '#/common/constants/order-status.constant';

@Entity('orders')
@Index(['companyId', 'status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  @Index()
  companyId: string;

  @Column({ name: 'order_reference', type: 'varchar', length: 255 })
  orderReference: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  /** Customer-facing identifier (e.g. "STK-9F3A2C"), distinct from the internal id and from the dispatcher-facing "#1023" display — this is what a future public tracking lookup queries by. */
  @Column({
    name: 'tracking_number',
    type: 'varchar',
    length: 32,
    unique: true,
  })
  @Index()
  trackingNumber: string;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  @Column({ name: 'customer_phone', type: 'varchar', length: 32 })
  customerPhone: string;
  
  @Column({ name: 'customer_email', type: 'varchar', length: 100, nullable:true })
  customerEmail: string | null;

  @Column(() => OrderLocationEmbed, { prefix: 'pickup' })
  pickupLocation: OrderLocationEmbed;

  /** Set when pickupLocation came from the company's saved locations — enables shared-pickup detection (groupStopsBySharedPickup on the frontend) once trips exist. Null for manually-searched pickups. */
  @Column({ name: 'pickup_saved_location_id', type: 'uuid', nullable: true })
  pickupSavedLocationId: string | null;

  @Column(() => OrderLocationEmbed, { prefix: 'dropoff' })
  dropoffLocation: OrderLocationEmbed;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @Column({ type: 'enum', enum: OrderPriority, default: OrderPriority.NORMAL })
  priority: OrderPriority;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  @Index()
  status: OrderStatus;

  @Column({ name: 'scheduled_for', type: 'timestamptz', nullable: true })
  scheduledFor: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** The dispatcher who created this order — plain Supabase user ID, no FK constraint, since auth.users lives in Supabase's own schema, not this database. */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  /** The driver currently assigned, if any. Same "no FK to Supabase's schema" reasoning. Null until dispatched. */
  @Column({ name: 'assigned_driver_user_id', type: 'uuid', nullable: true })
  @Index()
  assignedDriverUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
