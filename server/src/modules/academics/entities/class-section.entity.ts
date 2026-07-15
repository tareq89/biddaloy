import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Class } from './class.entity';

@Entity('class_sections')
@Index(['class_id', 'section_name'], { unique: true })
export class ClassSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Class, (c) => c.sections, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_id' })
  class: Class;

  @Column({ type: 'uuid' })
  class_id: string;

  @Column({ type: 'varchar', length: 20 })
  section_name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}