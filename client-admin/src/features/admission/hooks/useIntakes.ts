/**
 * [27.9] Staff CRUD hooks over `/admission-intakes` (server: waves 1-2,
 * `server/src/modules/admission/intake.controller.ts`). Kept in
 * `client-admin` rather than the shared `ui` hooks package — unlike
 * `grading`/`attendance`, admission review is a staff-only, single-app
 * screen for now, so there's no second app that would need this hook.
 *
 * `AdmissionIntake` deliberately does NOT carry an `applicant_count` field:
 * the wave 1-2 `IntakeService.findAll`/`findOne` (see
 * `server/src/modules/admission/intake.service.ts`) never joins against
 * `admission_applicants`, so there is nothing to read a count from yet.
 * The issue body's "applicant count" list column is dropped for the same
 * reason — see the plan-correction note in the `## Plan — #1044` comment.
 */
import { AdmissionDocumentType } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import { classSectionsQueryOptions, useClasses } from '@biddaloy/ui/hooks';
import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

export type IntakeStatus = 'OPEN' | 'CLOSED';

export interface AdmissionIntake {
  id: string;
  class_section_id: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
  status: IntakeStatus;
  created_at: string;
  updated_at: string;
}

export interface IntakeInput {
  title: string;
  class_section_id: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: AdmissionDocumentType[];
}

const intakeKeys = {
  all: ['admission-intakes'] as const,
  lists: () => [...intakeKeys.all, 'list'] as const,
  detail: (id: string) => [...intakeKeys.all, 'detail', id] as const,
};

export function intakesQueryOptions() {
  return queryOptions({
    queryKey: intakeKeys.lists(),
    queryFn: async () => {
      const res = await apiClient.get<AdmissionIntake[]>('/admission-intakes');
      return res.data;
    },
  });
}

export function useIntakes() {
  return useQuery(intakesQueryOptions());
}

export function intakeQueryOptions(id: string | undefined) {
  return queryOptions({
    queryKey: intakeKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<AdmissionIntake>(`/admission-intakes/${id}`);
      return res.data;
    },
    enabled: id !== undefined,
  });
}

export function useIntake(id: string | undefined) {
  return useQuery(intakeQueryOptions(id));
}

export function useCreateIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IntakeInput) => {
      const res = await apiClient.post<AdmissionIntake>('/admission-intakes', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: intakeKeys.lists() });
    },
  });
}

export function useUpdateIntake(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<IntakeInput>) => {
      const res = await apiClient.patch<AdmissionIntake>(`/admission-intakes/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: intakeKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: intakeKeys.lists() });
    },
  });
}

/** All required-document checkboxes the form/list can offer — the enum's
 * three values, in a stable order. */
export const ALL_DOCUMENT_TYPES: AdmissionDocumentType[] = [
  AdmissionDocumentType.PHOTO,
  AdmissionDocumentType.BIRTH_CERTIFICATE,
  AdmissionDocumentType.TRANSCRIPT,
];

export interface ClassSectionOption {
  id: string;
  className: string;
  sectionName: string;
}

/** "Class · Section" options for the intake form's section picker, and for
 * resolving a `class_section_id` back to a readable label in the list.
 * There's no flat "all sections" endpoint, so this fetches every class's
 * sections and flattens them — fine for a staff admin screen with at most
 * a few dozen classes, not a hot path.
 * ponytail: N+1 section fetches; add a flat `/classes/sections` endpoint
 * if a school's class count ever makes this slow. */
export function useClassSectionOptions() {
  const classesQuery = useClasses();
  const classIds = classesQuery.data?.data.map((klass) => klass.id) ?? [];
  const classNameById = new Map(
    classesQuery.data?.data.map((klass) => [klass.id, klass.name]) ?? [],
  );

  const sectionQueries = useQueries({
    queries: classIds.map((classId) => classSectionsQueryOptions(classId)),
  });

  const isLoading = classesQuery.isLoading || sectionQueries.some((query) => query.isLoading);

  const options: ClassSectionOption[] = sectionQueries.flatMap(
    (query, index): ClassSectionOption[] => {
      const sections = query.data ?? [];
      const classId = classIds[index];
      const className = classNameById.get(classId ?? '') ?? '';
      return sections.map((section) => ({
        id: section.id,
        className,
        sectionName: section.section_name,
      }));
    },
  );

  return { options, isLoading };
}
