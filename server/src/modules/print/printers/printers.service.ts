import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { AuditAction, PrinterType } from '@biddaloy/shared';
import { PrinterProfile } from '../entities/printer-profile.entity';
import { AuditService } from '../../audit/audit.service';
import { CreatePrinterProfileDto, UpdatePrinterProfileDto } from './dto/printer-profile.dto';

const NUMERIC_KEYS = [
  'margin_top_mm',
  'margin_right_mm',
  'margin_bottom_mm',
  'margin_left_mm',
  'offset_x_mm',
  'offset_y_mm',
  'scale',
  'sheet_gap_mm',
] as const;

/** Entity with its pg numeric strings turned into numbers. */
export type PrinterProfileView = Omit<PrinterProfile, (typeof NUMERIC_KEYS)[number] | 'tenant'> &
  Record<(typeof NUMERIC_KEYS)[number], number>;

/** Default no-print margin by printer type (D27). */
const DEFAULT_MARGIN_MM: Record<PrinterType, number> = { CARD: 0, OFFICE: 5 };

/** [32.2.x] Printer profile CRUD; every write is audited (D38). */
@Injectable()
export class PrintersService {
  constructor(
    @InjectRepository(PrinterProfile) private readonly repo: Repository<PrinterProfile>,
    private readonly audit: AuditService,
  ) {}

  private view(p: PrinterProfile): PrinterProfileView {
    const { tenant: _tenant, ...rest } = p;
    const out: Record<string, unknown> = { ...rest };
    for (const k of NUMERIC_KEYS) out[k] = Number(p[k]);
    return out as unknown as PrinterProfileView;
  }

  private snapshot(p: PrinterProfile): Record<string, unknown> {
    return this.view(p) as unknown as Record<string, unknown>;
  }

  async list(tenantId: string): Promise<PrinterProfileView[]> {
    const rows = await this.repo.find({
      where: { tenant_id: tenantId, archived_at: IsNull() },
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.view(r));
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreatePrinterProfileDto,
  ): Promise<PrinterProfileView> {
    const m = String(DEFAULT_MARGIN_MM[dto.printer_type]);
    const entity = this.repo.create({
      tenant_id: tenantId,
      margin_top_mm: m,
      margin_right_mm: m,
      margin_bottom_mm: m,
      margin_left_mm: m,
      ...this.stringify(dto),
    });
    const saved = await this.save(entity);
    await this.audit.record({
      action: AuditAction.CREATE,
      entity_type: 'PrinterProfile',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: null,
      new_values: this.snapshot(saved),
    });
    return this.view(saved);
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdatePrinterProfileDto,
  ): Promise<PrinterProfileView> {
    const row = await this.findActive(tenantId, id);
    const before = this.snapshot(row);
    const saved = await this.save(Object.assign(row, this.stringify(dto)));
    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'PrinterProfile',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: before,
      new_values: this.snapshot(saved),
    });
    return this.view(saved);
  }

  async archive(tenantId: string, userId: string, id: string): Promise<PrinterProfileView> {
    const row = await this.findActive(tenantId, id);
    const before = this.snapshot(row);
    row.archived_at = new Date();
    const saved = await this.repo.save(row);
    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'PrinterProfile',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: before,
      new_values: this.snapshot(saved),
    });
    return this.view(saved);
  }

  private async findActive(tenantId: string, id: string): Promise<PrinterProfile> {
    const row = await this.repo.findOne({
      where: { id, tenant_id: tenantId, archived_at: IsNull() },
    });
    if (!row) throw new NotFoundException('Printer not found');
    return row;
  }

  /** DTO numbers → the strings the entity's numeric columns type as. */
  private stringify(dto: UpdatePrinterProfileDto): Partial<PrinterProfile> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      // null on a NOT NULL column would 500; treat like "not sent".
      if (v !== undefined && v !== null) out[k] = typeof v === 'number' ? String(v) : v;
    }
    return out as Partial<PrinterProfile>;
  }

  /** Unique-index violation (active name per tenant, 32.1.2) → 409. */
  private async save(entity: PrinterProfile): Promise<PrinterProfile> {
    try {
      return await this.repo.save(entity);
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).driverError?.code === '23505') {
        throw new ConflictException('A printer with this name already exists');
      }
      throw err;
    }
  }
}
