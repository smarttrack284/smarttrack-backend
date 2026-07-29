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

export enum SavedLocationKind {
  SHOP = 'shop',
  WAREHOUSE = 'warehouse',
  OTHER = 'other',
}

/**
 * Mirrors the frontend's SavedLocation type (label, address, lat, lng,
 * kind) — the reusable pickup points dispatchers pick from in
 * LocationSearchDialog instead of re-geocoding the same shop/warehouse
 * every time, which is what keeps pickup coordinates identical across
 * order (see groupStopsBySharedPickup on the trip model).
 */
@Entity('saved_locations')
export class SavedLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  @Index()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 255 })
  label: string;

  @Column({ type: 'varchar', length: 500 })
  address: string;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'double precision' })
  lng: number;

  @Column({
    type: 'enum',
    enum: SavedLocationKind,
    default: SavedLocationKind.OTHER,
  })
  kind: SavedLocationKind;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
