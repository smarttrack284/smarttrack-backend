import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';
import { TripStop } from './trip-stop.entity';

@Entity('trips')
@Index(['companyId', 'driverUserId'])
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  @Index()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'trip_reference', type: 'varchar', length:100 })
  tripReference: string;

  /** No FK — auth.users lives in Supabase's own schema, not this database. Same pattern as Order.assignedDriverUserId. */
  @Column({ name: 'driver_user_id', type: 'uuid' })
  driverUserId: string;

  /** The dispatcher who created this trip. */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  /** Set the moment the first stop leaves PENDING — trip status derives from this + stop states, never stored directly. */
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @OneToMany(() => TripStop, (stop) => stop.trip, { cascade: true })
  stops: TripStop[];

  @Column({
    name: 'driver_location_lat',
    type: 'double precision',
    nullable: true,
  })
  driverLocationLat: number | null;

  @Column({
    name: 'driver_location_lng',
    type: 'double precision',
    nullable: true,
  })
  driverLocationLng: number | null;

  @Column({
    name: 'driver_location_updated_at',
    type: 'timestamptz',
    nullable: true,
  })
  driverLocationUpdatedAt: Date | null;

  @Column({
    name: 'driver_location_accuracy',
    type: 'double precision',
    nullable: true,
  })
  driverLocationAccuracy: number | null;

  @Column({
    name: 'driver_location_client_timestamp',
    type: 'timestamptz',
    nullable: true,
  })
  driverLocationClientTimestamp: Date | null;

  @Column({
    name: 'driver_speed_kph',
    type: 'double precision',
    nullable: true,
  })
  driverSpeedKph: number | null;

  @Column({
    name: 'driver_heading',
    type: 'double precision',
    nullable: true,
  })
  driverHeading: number | null;

  /** A jump too large/fast to trust immediately — held here pending confirmation by a corroborating follow-up point. Never broadcast while only a candidate. */
  @Column({
    name: 'candidate_location_lat',
    type: 'double precision',
    nullable: true,
  })
  candidateLocationLat: number | null;

  @Column({
    name: 'candidate_location_lng',
    type: 'double precision',
    nullable: true,
  })
  candidateLocationLng: number | null;

  @Column({
    name: 'candidate_location_at',
    type: 'timestamptz',
    nullable: true,
  })
  candidateLocationAt: Date | null;

  @Column({ name: 'eta_minutes', type: 'int', nullable: true })
  etaMinutes: number | null;

  @Column({ name: 'eta_calculated_at', type: 'timestamptz', nullable: true })
  etaCalculatedAt: Date | null;

  @Column({ name: 'eta_source', type: 'varchar', length: 16, nullable: true })
  etaSource: 'radar' | 'cached' | 'unavailable' | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date;
}
