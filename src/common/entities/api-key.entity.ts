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

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  @Index()
  companyId: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ length: 100, type: 'varchar' })
  name: string;

  /**
   * A SHA-256 (or similar) hash of the full key — never the key itself.
   * The plaintext key is shown to the user exactly once, at creation, and
   * is never stored or retrievable again — same "shown once" pattern as
   * the frontend's CreateApiKeyDialog. Verifying an incoming request means
   * hashing the presented key and comparing hashes, never decrypting
   * anything, since there's nothing reversible stored.
   */
  @Column({ name: 'key_hash', type: 'varchar', length: 255, unique: true })
  keyHash: string;

  /**
   * A masked preview for display in the UI — e.g. "sk_live_••••••••7f3d" —
   * computed once at creation from the plaintext key and stored alongside
   * the hash, since the hash itself can't be reversed to reconstruct a
   * preview later.
   */
  @Column({ name: 'key_preview', type: 'varchar', length: 32 })
  keyPreview: string;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  /**
   * Soft-revoke instead of deleting the row — keeps an audit trail of keys
   * that existed and were revoked, which matters if you ever need to
   * investigate "was this key active when this request came in."
   */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
