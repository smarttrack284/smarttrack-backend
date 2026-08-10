import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from './company.entity';

/**
 * One row per company. `ordersThisPeriod` resets each billing period (a
 * scheduled job to roll periodStart/periodEnd forward and zero this out is
 * a separate piece of infrastructure not built here). `teamMembersCount`
 * is a running total, not period-based — it's decremented/incremented as
 * members join/leave, not reset monthly.
 */
@Entity('usages')
export class Usage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid', unique: true })
  companyId: string;

  @OneToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ name: 'orders_this_period', type: 'int', default: 0 })
  ordersThisPeriod: number;

  @Column({ name: 'team_members_count', type: 'int', default: 0 })
  teamMembersCount: number;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date;
}
