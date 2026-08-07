import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { TeamRoleType } from '#/common/types/team-role.type';
import { TeamMemberStatus } from '#/common/constants/team-member-status.constant';
import { Company } from '#/common/entities/company.entity';

// import { NotificationSetting } from "./notification-setting.entity";

@Entity("user_roles")
export class UserRole {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ name: "user_id", type: "uuid", nullable: true, unique: true })
    @Index()
    userId: string | null;

    @Column({ type: "varchar", length: 255, unique: true })
    email: string;

    @Column({ name: "company_id", type: "uuid" })
    @Index()
    companyId: string;

    @ManyToOne(() => Company, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'company_id' })
    company: Company;



    @Column({ type: "varchar", length: 255, nullable: true })
    name: string | null;

    @Column({ type: "enum", enum: TeamRoleType })
    role: TeamRoleType;

    @Column({
        type: "enum",
        enum: TeamMemberStatus,
        default: TeamMemberStatus.INVITED
    })
    status: TeamMemberStatus;

    @Column({ name: "invited_at", type: "timestamptz", nullable: true })
    invitedAt: Date | null;

    @Column({ name: "joined_at", type: "timestamptz", nullable: true })
    joinedAt: Date | null;

    @Column({
        name: "invite_token_hash",
        type: "varchar",
        length: 255,
        nullable: true
    })
    inviteTokenHash: string | null;

    @Column({
        name: "invite_token_expires_at",
        type: "timestamptz",
        nullable: true
    })
    inviteTokenExpiresAt: Date | null;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
