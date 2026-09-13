/**
 * [16.2.4] Step-up approval — wrapping a mutation with `useApprovedMutation`
 * is the ONLY approval code a feature needs to write. A mutation that comes
 * back `403 { code: 'APPROVAL_REQUIRED' }` (the D9 contract) gets retried
 * once with an `X-Approval-Token` header obtained by walking an admin
 * through `AdminVerificationModal`; every other outcome (success, or any
 * other error) passes straight through.
 *
 * `ui/src/api/client.ts`'s `apiClient` already forwards caller-supplied
 * headers untouched (its request interceptor only ever `.set()`s
 * tenant/role/auth headers — see that file's own comment) — no change
 * needed there, `mutationFn` just needs to accept an options bag and pass
 * it through to `apiClient`.
 *
 * `useStepUp` is the two network calls this flow needs
 * (`POST /auth/step-up/otp/request`, `POST /auth/step-up`); factored out
 * of `useApprovedMutation` so a caller could drive `AdminVerificationModal`
 * directly if it ever needed to (none does yet).
 */
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import * as React from 'react';

import { apiClient } from '../api/client';
import { ApiError, RateLimitedError } from '../api/errors';
import type { AdminVerificationError, ApprovalMethod, ApprovalResult } from '../components/admin-verification-modal';
import { AdminVerificationModal } from '../components/admin-verification-modal';

/** Rejected by a cancelled approval — `useApprovedMutation`'s caller sees
 * this rather than a generic `Error` so it can special-case "the admin
 * closed the modal" (e.g. don't show a toast) if it wants to. */
export class ApprovalCancelledError extends Error {
  constructor() {
    super('Approval was cancelled.');
    this.name = 'ApprovalCancelled';
  }
}

/** Duck-typed against the server's error envelope, same reasoning as
 * `ui/src/api/errors.ts`'s own `isTenantSuspendedError`: a 403 whose
 * `details.code` is `APPROVAL_REQUIRED` is this flow's trigger, regardless
 * of which endpoint returned it. */
function isApprovalRequiredError(error: unknown): boolean {
  const candidate = error as Partial<ApiError> | null | undefined;
  return (
    candidate?.statusCode === 403 &&
    (candidate.details as { code?: unknown } | undefined)?.code === 'APPROVAL_REQUIRED'
  );
}

function toVerificationError(error: unknown): AdminVerificationError {
  if (error instanceof RateLimitedError) {
    return { code: 'RATE_LIMITED', message: error.message };
  }
  if (error instanceof ApiError) {
    const code = (error.details as { code?: string } | undefined)?.code;
    return code ? { code, message: error.message } : { message: error.message };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export interface StepUpVerifyInput {
  identifier: string;
  method: ApprovalMethod;
  code?: string;
  password?: string;
}

/** The two `/auth/step-up*` calls, isolated from `useApprovedMutation`'s
 * retry orchestration below so `AdminVerificationModal`'s own tests/stories
 * can drive them directly without a wrapped mutation in the loop. */
export function useStepUp() {
  const requestOtpMutation = useMutation({
    mutationFn: (identifier: string) =>
      apiClient.post<void>('/auth/step-up/otp/request', { identifier }),
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: async (input: StepUpVerifyInput) =>
      (await apiClient.post<ApprovalResult>('/auth/step-up', input)).data,
    retry: false,
  });

  return {
    requestOtp: (identifier: string) => requestOtpMutation.mutateAsync(identifier).then(() => undefined),
    verify: (input: StepUpVerifyInput) => verifyMutation.mutateAsync(input),
    isRequestingOtp: requestOtpMutation.isPending,
    isVerifying: verifyMutation.isPending,
  };
}

/** `Omit<UseMutationOptions, 'mutationFn' | 'scope'>`: TanStack Query's own
 * `UseMutationOptions.scope` (mutation concurrency grouping) is a different
 * concept from this hook's `approvalScope` (the human-facing action being
 * approved) — named `approvalScope` rather than `scope` precisely to avoid
 * colliding with that reserved option. */
export interface ApprovedMutationOptions<TVariables, TResult>
  extends Omit<UseMutationOptions<TResult, unknown, TVariables>, 'mutationFn' | 'scope'> {
  /** Machine key for `AdminVerificationModal`'s scope label. */
  approvalScope: string;
  /** Derived from the school's auth settings — see `AdminVerificationModal`'s
   * own doc comment on why this is a plain boolean rather than a query this
   * hook runs itself. */
  passwordAllowed?: boolean;
}

/** A type intersection, not `interface ... extends` — `UseMutationResult` is
 * a discriminated union (idle/pending/success/error), not a plain object
 * type, and an interface can only extend statically-known object members. */
export type ApprovedMutationResult<TVariables, TResult> = UseMutationResult<
  TResult,
  unknown,
  TVariables
> & {
  /** Render this once, anywhere in the calling component's tree — it's a
   * no-op (`null`) whenever no approval is pending. This is the one line
   * of "approval code" a feature needs beyond calling
   * `useApprovedMutation(fn, { approvalScope })` itself. */
  modal: React.ReactNode;
};

/** Only the first `useApprovedMutation` instance mounted at any moment
 * renders `AdminVerificationModal` — if two components on screen both wrap
 * a mutation with this hook, the second's `modal` stays `null` rather than
 * mounting a second `Dialog` portal. Since only one step-up can be in
 * flight at a time in practice (an admin can only be looking at one
 * approval prompt), this just guards the pathological case where two
 * mounted callers would otherwise fight over the same DOM. */
let hostClaimed = false;

function useIsModalHost(): boolean {
  const [isHost] = React.useState(() => {
    if (hostClaimed) return false;
    hostClaimed = true;
    return true;
  });
  React.useEffect(
    () => () => {
      if (isHost) hostClaimed = false;
    },
    [isHost],
  );
  return isHost;
}

/**
 * Wraps `mutationFn` so an `APPROVAL_REQUIRED` response opens
 * `AdminVerificationModal`, waits for a token, and retries exactly once.
 * A second `APPROVAL_REQUIRED` on the retry is not looped — it surfaces to
 * the caller as a normal mutation error, same as any other failure.
 */
export function useApprovedMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables, options: { headers?: Record<string, string> }) => Promise<TResult>,
  {
    approvalScope,
    passwordAllowed = false,
    ...mutationOptions
  }: ApprovedMutationOptions<TVariables, TResult>,
): ApprovedMutationResult<TVariables, TResult> {
  const isHost = useIsModalHost();
  const stepUp = useStepUp();

  const [pending, setPending] = React.useState<{
    resolve: (result: ApprovalResult) => void;
    reject: (error: unknown) => void;
  } | null>(null);
  const [verifyError, setVerifyError] = React.useState<AdminVerificationError | null>(null);

  function requestApproval(): Promise<ApprovalResult> {
    return new Promise((resolve, reject) => {
      if (!isHost) {
        // See `useIsModalHost`'s own comment: only the host instance ever
        // renders `AdminVerificationModal`. A non-host instance rejects
        // immediately instead of setting `pending` state nobody will ever
        // render a UI for, which would otherwise hang the mutation forever.
        reject(new Error('useApprovedMutation: no modal host mounted to show the approval prompt.'));
        return;
      }
      setVerifyError(null);
      setPending({ resolve, reject });
    });
  }

  async function handleRequestOtp(identifier: string): Promise<void> {
    try {
      await stepUp.requestOtp(identifier);
      setVerifyError(null);
    } catch (error) {
      setVerifyError(toVerificationError(error));
      throw error;
    }
  }

  const mutation = useMutation<TResult, unknown, TVariables>({
    ...mutationOptions,
    mutationFn: async (variables: TVariables) => {
      try {
        return await mutationFn(variables, {});
      } catch (error) {
        if (!isApprovalRequiredError(error)) throw error;
        const { approval_token } = await requestApproval();
        // A second APPROVAL_REQUIRED here is not caught — it propagates
        // as a normal error rather than looping back into the modal.
        return await mutationFn(variables, { headers: { 'X-Approval-Token': approval_token } });
      }
    },
  });

  async function handleVerify(input: StepUpVerifyInput): Promise<ApprovalResult> {
    try {
      const result = await stepUp.verify(input);
      setVerifyError(null);
      return result;
    } catch (error) {
      setVerifyError(toVerificationError(error));
      throw error;
    }
  }

  function handleSuccess(result: ApprovalResult) {
    pending?.resolve(result);
    setPending(null);
  }

  function handleCancel() {
    pending?.reject(new ApprovalCancelledError());
    setPending(null);
    setVerifyError(null);
  }

  const modal =
    isHost && pending ? (
      <AdminVerificationModal
        open
        scope={approvalScope}
        passwordAllowed={passwordAllowed}
        onRequestOtp={handleRequestOtp}
        onVerify={handleVerify}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
        loading={stepUp.isVerifying}
        requestingOtp={stepUp.isRequestingOtp}
        error={verifyError}
      />
    ) : null;

  return { ...mutation, modal };
}
