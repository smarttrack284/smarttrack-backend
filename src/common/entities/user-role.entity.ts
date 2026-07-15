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
import { TeamRoleType } from '#/common/types/team-role.type';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import { Company } from '#/common/entities/company.entity';

@Entity('user_roles')
@Index(['email', 'companyId'], { unique: true }) // one membership/invite per email per company
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Null until the invited person actually signs up and the invite is
   * accepted (see TeamService.acceptPendingInvite) — an invite can exist
   * as a row with no linked Supabase account yet. Email, not userId, is
   * the stable identifier for a membership from the moment it's created.
   */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  @Index()
  userId: string | null;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'company_id', type: 'uuid' })
  @Index()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'enum', enum: TeamRoleType })
  role: TeamRoleType;

  @Column({ type: 'enum', enum: TeamMemberStatus, default: TeamMemberStatus.INVITED })
  status: TeamMemberStatus;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt: Date | null;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}