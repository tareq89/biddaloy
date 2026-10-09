import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { PrintAssetKind } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';

/**
 * [32.1.2] An uploaded artwork image, template image or font (Epic 32 D17,
 * D56). Bytes live in `StorageService` under `storage_key`; keys are never
 * deleted while a published version may reference them — assets are
 * archived, not removed.
 */
@Entity('print_assets')
@Index(['tenant_id'])
export class PrintAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'varchar', length: 20 })
  asset_kind: PrintAssetKind;

  @Column({ type: 'varchar', length: 255 })
  storage_key: string;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  @Column({ type: 'int' })
  byte_size: number;

  @Column({ type: 'int', nullable: true })
  width_px: number | null;

  @Column({ type: 'int', nullable: true })
  height_px: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  font_family: string | null;

  @Column({ type: 'varchar', length: 255 })
  original_name: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploaded_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploaded_by: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
