import type {
  ImpersonationSessionDto,
  LoginAsCandidatesResponse,
  StartImpersonationRequest,
  StartImpersonationResponse,
} from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { useIdempotencyKey } from './idempotency-key';
import { getApprovalRequestId } from './platform-approvals';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type {
  ImpersonationSessionDto,
  LoginAsCandidatesResponse,
  StartImpersonationRequest,
  StartImpersonationResponse,
};

export const impersonationKeys = createEntityKeys<{ scope?: 'live' | 'recent'; limit?: number }>(
  'platform-impersonation',
);
export const loginAsCandidateKeys = {
  all: ['platform-login-as-candidates'] as const,
  forSchool: (schoolId: string | undefined, role?: string) =>
    ['platform-login-as-candidates', schoolId, role ?? null] as const,
};

/** Rule 5: the server caps `limit` at 100. */
export const clampLimit = (limit = 25) => Math.min(Math.max(limit, 1), 100);

/** What the screen shows after "Start Login as". */
export type StartLoginAsResult =
  | { kind: 'code'; code: string; expiresAt: string; sessionId: string }
  /** `ask` mode (an admin must approve) or a two-person approval (the other owner must agree). */
  | { kind: 'waiting'; requestId: string }
  /** School is `blocked`: only an emergency read-only entry, behind the other owner. */
  | { kind: 'blocked-needs-owner'; requestId: string };

export interface StartLoginAsInput extends StartImpersonationRequest {
  /** From `LoginAsCandidatesResponse.supportAccessMode`; tells "blocked" from a plain two-person wait. */
  supportMode?: 'allowed' | 'ask' | 'blocked';
}

export function useLoginAsSessions(params: { scope?: 'live' | 'recent'; limit?: number } = {}) {
  const query = { scope: params.scope ?? 'live', limit: clampLimit(params.limit) };
  return useQuery({
    queryKey: impersonationKeys.list(query),
    queryFn: ({ signal }) =>
      cockpitRequest<ImpersonationSessionDto[]>({
        url: '/platform/impersonation',
        params: query,
        signal,
      }),
    retry: shouldRetryQuery,
  });
}

export function useLoginAsCandidates(schoolId: string | undefined, role?: string) {
  return useQuery({
    queryKey: loginAsCandidateKeys.forSchool(schoolId, role),
    queryFn: ({ signal }) =>
      cockpitRequest<LoginAsCandidatesResponse>({
        url: `/platform/schools/${schoolId}/login-as/candidates`,
        params: { role },
        signal,
      }),
    enabled: !!schoolId,
    retry: shouldRetryQuery,
  });
}

/**
 * Start Login as. Needs a step-up code (`platform.login_as`). The 403 `APPROVAL_REQUESTED` body
 * becomes `waiting` (or `blocked-needs-owner` for a blocked school). A repeated click re-sends the
 * same `Idempotency-Key` (one key per body, rotated after the result is shown).
 */
export function useStartLoginAs() {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    async (
      { supportMode, ...body }: StartLoginAsInput,
      { headers },
    ): Promise<StartLoginAsResult> => {
      try {
        const res = await cockpitRequest<StartImpersonationResponse>({
          method: 'POST',
          url: '/platform/impersonation',
          data: body,
          headers: { ...headers, 'Idempotency-Key': keyFor(body) },
        });
        if (res.code && res.expiresAt) {
          return { kind: 'code', code: res.code, expiresAt: res.expiresAt, sessionId: res.id };
        }
        return { kind: 'waiting', requestId: res.id };
      } catch (error) {
        const requestId = getApprovalRequestId(error);
        if (!requestId) throw error;
        // A blocked school answers 403 APPROVAL_REQUESTED too (emergency entry, other owner agrees).
        return supportMode === 'blocked'
          ? { kind: 'blocked-needs-owner', requestId }
          : { kind: 'waiting', requestId };
      }
    },
    {
      approvalScope: 'platform.login_as',
      onSuccess: () => {
        rotate();
        void queryClient.invalidateQueries({ queryKey: impersonationKeys.all });
      },
    },
  );
}

/** Owner of an emergency session asks the school's admins to allow writing. */
export function useRequestLoginAsWrite() {
  return useApprovedMutation(
    ({ id, reason }: { id: string; reason: string }, { headers }) =>
      cockpitRequest({
        method: 'POST',
        url: `/platform/impersonation/${id}/request-write`,
        data: { reason },
        headers,
      }),
    { approvalScope: 'platform.login_as' },
  );
}

/** Either owner may end any session; no step-up. */
export function useEndLoginAs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      cockpitRequest({ method: 'DELETE', url: `/platform/impersonation/${id}` }),
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: impersonationKeys.all }),
  });
}
