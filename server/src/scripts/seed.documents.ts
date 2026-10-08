import { IsNull, type Repository } from 'typeorm';
import { DocumentKind } from '@biddaloy/shared';
import type { PrintJobItem } from '../modules/print/entities/print-job-item.entity';
import type { PrintTemplate } from '../modules/print/entities/print-template.entity';
import type { Student } from '../modules/students/entities/student.entity';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

// Kept out of seed.ts for the same reason as seed.lifecycle.ts: nothing here may
// reach AppModule, so a unit spec can import it without an .env.

/** The real service calls, handed in by `seed.ts` so templates and serials go through the API's code paths. */
export interface DocumentsSeedPorts {
  createTemplate(suggestionKey: string, name: string): Promise<{ id: string }>;
  publishTemplate(id: string): Promise<unknown>;
  setDefaultTemplate(id: string): Promise<unknown>;
  /** Issues one certificate (real serial, verify token) and returns the job to confirm. */
  issueCertificate(input: {
    templateId: string;
    studentId: string;
    issueValues: Record<string, string>;
  }): Promise<{ job_id: string }>;
  confirmJob(jobId: string, failedItemIds: string[]): Promise<unknown>;
  /** Revokes one issued copy with a reason (D22), through the register's own service. */
  revokeItem(itemId: string, reason: string): Promise<unknown>;
}

export interface DocumentsSeedRepositories {
  printTemplateRepository: Repository<PrintTemplate>;
  printJobItemRepository: Repository<PrintJobItem>;
  studentRepository: Repository<Student>;
}

const TEMPLATES = [
  { name: 'Admit card (Bangla)', suggestion: 'admit-card-bn' },
  { name: 'Transfer certificate (A4, Bangla)', suggestion: 'tc-a4-bn' },
  { name: 'Testimonial (A4, Bangla)', suggestion: 'testimonial-a4-bn' },
  { name: 'Character certificate (A4, Bangla)', suggestion: 'character-a4-bn' },
  // [48.3.99] Defaults for the result and merit certificates the exam Print flow offers.
  { name: 'Result certificate (A4, Bangla)', suggestion: 'result-a4-bn' },
  { name: 'Merit certificate (A4, Bangla)', suggestion: 'merit-a4-bn' },
] as const;

/** Demo roster student -> the certificate they were issued (0002 left, 0003 graduated; see seed.lifecycle.ts). */
const CONDUCT = 'সন্তোষজনক';
// A template only accepts the issue.* fields its sentences use: the testimonial has no remark.
const ISSUED = [
  {
    n: 2,
    template: TEMPLATES[1].name,
    kind: DocumentKind.TRANSFER_CERTIFICATE,
    values: { 'issue.conduct': CONDUCT, 'issue.remark': '—' },
  },
  {
    n: 3,
    template: TEMPLATES[2].name,
    kind: DocumentKind.TESTIMONIAL,
    values: { 'issue.conduct': CONDUCT },
  },
] as const;

/** [48.3.99] Student 0004 gets a testimonial that is then revoked, so the register shows a D39 row. */
const REVOKED = { n: 4, reason: 'ভুল নাম ছাপা হয়েছে' } as const;

/**
 * [48.2.15] Published default templates for the admit card, TC, testimonial and character
 * certificate, plus one TC and one testimonial issued through the real services (so they get
 * real serials). Idempotent: a template is skipped when its name exists, a certificate when the
 * student already has an item of that kind.
 */
export async function ensureDocumentsSeed(
  repos: DocumentsSeedRepositories,
  ports: DocumentsSeedPorts,
  tenantId: string,
): Promise<{ templates: number; certificates: number; revoked: number }> {
  const result = { templates: 0, certificates: 0, revoked: 0 };
  const idByName = new Map<string, string>();

  for (const t of TEMPLATES) {
    // Live templates only: an archived one cannot print (404), and its name is free to reuse.
    const existing = await repos.printTemplateRepository.findOne({
      where: { tenant_id: tenantId, name: t.name, archived_at: IsNull() },
    });
    if (existing?.current_version_id) {
      idByName.set(t.name, existing.id);
      continue;
    }
    const id = existing?.id ?? (await ports.createTemplate(t.suggestion, t.name)).id;
    await ports.publishTemplate(id);
    await ports.setDefaultTemplate(id);
    idByName.set(t.name, id);
    result.templates += 1;
  }

  for (const c of ISSUED) {
    const student = await repos.studentRepository.findOne({
      where: {
        tenant_id: tenantId,
        registration_number: `${DEMO_ACADEMIC_YEAR.name}-${String(c.n).padStart(4, '0')}`,
      },
    });
    const templateId = idByName.get(c.template);
    if (!student || !templateId) continue;
    const already = await repos.printJobItemRepository.findOne({
      where: { tenant_id: tenantId, subject_id: student.id, document_kind: c.kind },
    });
    if (already) continue;
    const job = await ports.issueCertificate({
      templateId,
      studentId: student.id,
      issueValues: { ...c.values },
    });
    await ports.confirmJob(job.job_id, []);
    result.certificates += 1;
  }

  const revokedStudent = await repos.studentRepository.findOne({
    where: {
      tenant_id: tenantId,
      registration_number: `${DEMO_ACADEMIC_YEAR.name}-${String(REVOKED.n).padStart(4, '0')}`,
    },
  });
  const testimonialId = idByName.get(TEMPLATES[2].name);
  if (revokedStudent && testimonialId) {
    const done = await repos.printJobItemRepository.findOne({
      where: {
        tenant_id: tenantId,
        subject_id: revokedStudent.id,
        document_kind: DocumentKind.TESTIMONIAL,
      },
    });
    if (!done) {
      const job = await ports.issueCertificate({
        templateId: testimonialId,
        studentId: revokedStudent.id,
        issueValues: { 'issue.conduct': CONDUCT },
      });
      await ports.confirmJob(job.job_id, []);
      result.certificates += 1;
      const item = await repos.printJobItemRepository.findOne({
        where: {
          tenant_id: tenantId,
          subject_id: revokedStudent.id,
          document_kind: DocumentKind.TESTIMONIAL,
        },
      });
      if (item) {
        await ports.revokeItem(item.id, REVOKED.reason);
        result.revoked += 1;
      }
    }
  }
  return result;
}
