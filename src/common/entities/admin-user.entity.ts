import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from "typeorm";
import { AdminRole } from "#/common/constants/admin-role.constant";

@Entity("admin_users")
export class AdminUser {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index({ unique: true })
    @Column({ name: "user_id", type: "uuid" })
    userId: string;

    @Column({ type: "varchar", length: 255 })
    name: string;

    @Index({ unique: true })
    @Column({ type: "varchar", length: 255 })
    email: string;

    @Column({
        type: "enum",
        enum: AdminRole,
        default: AdminRole.SUPPORT
    })
    role: AdminRole;

    @Column({ name: "is_active", type: "boolean", default: true })
    isActive: boolean;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
    updatedAt: Date;
}
