import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SavedLocation } from './saved-location.entity';
import { ApiKey } from './api-key.entity';
import { CompanyNotificationSetting } from '#/common/entities/company-notification-settings.entity';

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

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'logo_filename',
  })
  logoFilename: string | null;

  @OneToMany(() => SavedLocation, (location) => location.company)
  savedLocations: SavedLocation[];

  @OneToMany(() => ApiKey, (apiKey) => apiKey.company)
  apiKeys: ApiKey[];

  @OneToOne(
    () => CompanyNotificationSetting,
    (notificationSettings) => notificationSettings.company,
  )
  notificationSettings: CompanyNotificationSetting;

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

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date;
}
