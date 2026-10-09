import type { EntityManager } from 'typeorm';
import { DocumentKind } from '@biddaloy/shared';
import { StudentCardResolver } from './student-card.resolver';
import { StaffCardResolver } from './staff-card.resolver';
import { AcrAssessmentResolver } from './acr-assessment.resolver';

export interface ResolvedSubject {
  label: string;
  /** Every FIELD_CATALOG key for the kind; '' when unknown. */
  values: Record<string, string>;
  photoKey: string | null;
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
  ): Promise<Map<string, ResolvedSubject>>;
}

export const RESOLVERS: Record<DocumentKind, FieldResolver> = {
  [DocumentKind.STUDENT_ID_CARD]: new StudentCardResolver(),
  [DocumentKind.STAFF_ID_CARD]: new StaffCardResolver(),
  [DocumentKind.ACR_ASSESSMENT]: new AcrAssessmentResolver(),
};
