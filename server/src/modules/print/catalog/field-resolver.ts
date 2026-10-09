import type { EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { DocumentKind, type PrintContextType } from '@biddaloy/shared';
import { StudentCardResolver } from './student-card.resolver';
import { StaffCardResolver } from './staff-card.resolver';
import { AcrAssessmentResolver } from './acr-assessment.resolver';

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
};

export function resolverFor(kind: DocumentKind): FieldResolver {
  const resolver = RESOLVERS[kind];
  if (!resolver) throw new BadRequestException(`No resolver for ${kind}`);
  return resolver;
}
