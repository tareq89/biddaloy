import type { EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { DocumentKind, STUDENT_CERTIFICATE_KINDS, type PrintContextType } from '@biddaloy/shared';
import { StudentCardResolver } from './student-card.resolver';
import { StaffCardResolver } from './staff-card.resolver';
import { AcrAssessmentResolver } from './acr-assessment.resolver';
import { AdmitCardResolver } from './admit-card.resolver';
import { StudentCertificateResolver } from './student-certificate.resolver';
import { ResultCertificateResolver } from './result-certificate.resolver';

export interface ResolvedSubject {
  label: string;
  /** Every FIELD_CATALOG key for the kind; '' when unknown. */
  values: Record<string, string>;
  photoKey: string | null;
}

/** What a kind is printed for besides its subject (e.g. the exam of an admit card). */
export interface PrintContext {
  type: PrintContextType;
  id: string;
}

export interface FieldResolver {
  kind: DocumentKind;
  subjectType: 'STUDENT' | 'STAFF' | 'ACR';
  /** Only subjects that exist in `tenantId` come back; a missing id means not found. */
  resolve(
    tenantId: string,
    subjectIds: string[],
    manager: EntityManager,
    /** The printing user; ACR refuses a caller's own assessment. */
    callerId?: string,
    context?: PrintContext,
  ): Promise<Map<string, ResolvedSubject>>;
}

export const RESOLVERS: Partial<Record<DocumentKind, FieldResolver>> = {
  [DocumentKind.STUDENT_ID_CARD]: new StudentCardResolver(),
  [DocumentKind.STAFF_ID_CARD]: new StaffCardResolver(),
  [DocumentKind.ACR_ASSESSMENT]: new AcrAssessmentResolver(),
  [DocumentKind.EXAM_ADMIT_CARD]: new AdmitCardResolver(),
  ...Object.fromEntries(
    STUDENT_CERTIFICATE_KINDS.map((k) => [k, new StudentCertificateResolver(k)]),
  ),
  [DocumentKind.RESULT_CERTIFICATE]: new ResultCertificateResolver(DocumentKind.RESULT_CERTIFICATE),
  [DocumentKind.MERIT_CERTIFICATE]: new ResultCertificateResolver(DocumentKind.MERIT_CERTIFICATE),
};

export function resolverFor(kind: DocumentKind): FieldResolver {
  const resolver = RESOLVERS[kind];
  if (!resolver) throw new BadRequestException(`No resolver for ${kind}`);
  return resolver;
}
