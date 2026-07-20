import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SavedLocation } from './saved-location.entity';
import { ApiKey } from './api-key.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
  })
  email: string;

  @Column({ type: 'varchar', length: 100 })
  timezone: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    name: 'logo_url',
  })
  logoUrl: string | null;

  @OneToMany(() => SavedLocation, (location) => location.company)
  savedLocations: SavedLocation[];

  @OneToMany(() => ApiKey, (apiKey) => apiKey.company)
  apiKeys: ApiKey[];

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt: Date;
}
