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
 *
 * ## Who renders the modal
 *
 * One `<ApprovalModalHostProvider>` near the app root owns the single
 * `AdminVerificationModal`; every `useApprovedMutation` on the page asks it
 * for approval through context. This replaced a module-level
 * "first hook instance to mount claims the modal" singleton, which was a
 * real bug: two components mounted at the same time (e.g. the student
 * detail page's `RecordPaymentModal` and its discounts tab) raced for the
 * claim, and whichever lost rejected its own approval with
 * "no modal host mounted" instead of ever showing the prompt. Ownership
 * now comes from the tree, not from mount order.
 *
 * ```
 * <ApprovalModalHostProvider>          <- renders AdminVerificationModal
 *   <RecordPaymentModal/>              <- useCheckout()        ─┐
 *   <DiscountsSection/>                <- useCreateDiscountRule ┴─> requestApproval()
 * </ApprovalModalHostProvider>
 * ```
 */
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import * as React from 'react';

import { apiClient } from '../api/client';
import { ApiError, RateLimitedError } from '../api/errors';
import type {
  AdminVerificationError,
  ApprovalMethod,
  ApprovalResult,
} from '../components/admin-verification-modal';
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
    requestOtp: (identifier: string) =>
      requestOtpMutation.mutateAsync(identifier).then(() => undefined),
    verify: (input: StepUpVerifyInput) => verifyMutation.mutateAsync(input),
    isRequestingOtp: requestOtpMutation.isPending,
    isVerifying: verifyMutation.isPending,
  };
}

/** What a wrapped mutation asks the host for. */
export interface ApprovalRequest {
  /** Machine key for `AdminVerificationModal`'s scope label. */
  scope: string;
  passwordAllowed: boolean;
}

export type RequestApproval = (request: ApprovalRequest) => Promise<ApprovalResult>;

const ApprovalHostContext = React.createContext<RequestApproval | null>(null);

interface QueuedApproval extends ApprovalRequest {
  id: number;
  resolve: (result: ApprovalResult) => void;
  reject: (error: unknown) => void;
}

/**
 * Renders the app's one `AdminVerificationModal` and hands every
 * `useApprovedMutation` below it a `requestApproval()`.
 *
 * Two approvals asked for at once are **queued**, not dropped: only one
 * `AdminVerificationModal` is on screen at a time (an admin can only answer
 * one prompt anyway), and the second prompt opens as soon as the first
 * settles. Queueing rather than rejecting the loser is what makes this
 * independent of mount order — nothing about "who asked first" changes
 * whether an approval is reachable.
 */
export function ApprovalModalHostProvider({ children }: { children: React.ReactNode }) {
  const stepUp = useStepUp();
  const [queue, setQueue] = React.useState<QueuedApproval[]>([]);
  const [verifyError, setVerifyError] = React.useState<AdminVerificationError | null>(null);
  const nextId = React.useRef(0);

  const requestApproval = React.useCallback<RequestApproval>(
    ({ scope, passwordAllowed }) =>
      new Promise<ApprovalResult>((resolve, reject) => {
        nextId.current += 1;
        setQueue((current) => [
          ...current,
          { id: nextId.current, scope, passwordAllowed, resolve, reject },
        ]);
      }),
    [],
  );

  const current = queue[0] ?? null;

  async function handleRequestOtp(identifier: string): Promise<void> {
    try {
      await stepUp.requestOtp(identifier);
      setVerifyError(null);
    } catch (error) {
      setVerifyError(toVerificationError(error));
      throw error;
    }
  }

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

  /** Pops the head of the queue; the next one (if any) opens a fresh modal
   * because `key={current.id}` remounts it with empty inputs. */
  function dequeue() {
    setQueue((rest) => rest.slice(1));
    setVerifyError(null);
  }

  function handleSuccess(result: ApprovalResult) {
    current?.resolve(result);
    dequeue();
  }

  function handleCancel() {
    current?.reject(new ApprovalCancelledError());
    dequeue();
  }

  return (
    <ApprovalHostContext.Provider value={requestApproval}>
      {children}
      {current ? (
        <AdminVerificationModal
          key={current.id}
          open
          scope={current.scope}
          passwordAllowed={current.passwordAllowed}
          onRequestOtp={handleRequestOtp}
          onVerify={handleVerify}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
          loading={stepUp.isVerifying}
          requestingOtp={stepUp.isRequestingOtp}
          error={verifyError}
        />
      ) : null}
    </ApprovalHostContext.Provider>
  );
}

/** `Omit<UseMutationOptions, 'mutationFn' | 'scope'>`: TanStack Query's own
 * `UseMutationOptions.scope` (mutation concurrency grouping) is a different
 * concept from this hook's `approvalScope` (the human-facing action being
 * approved) — named `approvalScope` rather than `scope` precisely to avoid
 * colliding with that reserved option. */
export interface ApprovedMutationOptions<TVariables, TResult> extends Omit<
  UseMutationOptions<TResult, unknown, TVariables>,
  'mutationFn' | 'scope'
> {
  /** Machine key for `AdminVerificationModal`'s scope label. */
  approvalScope: string;
  /** Derived from the school's auth settings — see `AdminVerificationModal`'s
   * own doc comment on why this is a plain boolean rather than a query this
   * hook runs itself. */
  passwordAllowed?: boolean;
}

/** Plain `UseMutationResult` — the approval modal is rendered by
 * `ApprovalModalHostProvider`, so callers render nothing of their own.
 * (This used to carry an extra `modal: React.ReactNode` that each caller
 * had to drop into its JSX.) */
export type ApprovedMutationResult<TVariables, TResult> = UseMutationResult<
  TResult,
  unknown,
  TVariables
>;

/**
 * Wraps `mutationFn` so an `APPROVAL_REQUIRED` response opens
 * `AdminVerificationModal`, waits for a token, and retries exactly once.
 * A second `APPROVAL_REQUIRED` on the retry is not looped — it surfaces to
 * the caller as a normal mutation error, same as any other failure.
 *
 * Requires an `<ApprovalModalHostProvider>` somewhere above it. Without one
 * the mutation fails loudly with an explanatory error rather than hanging.
 */
export function useApprovedMutation<TVariables, TResult>(
  mutationFn: (
    variables: TVariables,
    options: { headers?: Record<string, string> },
  ) => Promise<TResult>,
  {
    approvalScope,
    passwordAllowed = false,
    ...mutationOptions
  }: ApprovedMutationOptions<TVariables, TResult>,
): ApprovedMutationResult<TVariables, TResult> {
  const requestApproval = React.useContext(ApprovalHostContext);

  return useMutation<TResult, unknown, TVariables>({
    ...mutationOptions,
    mutationFn: async (variables: TVariables) => {
      try {
        return await mutationFn(variables, {});
      } catch (error) {
        if (!isApprovalRequiredError(error)) throw error;
        if (!requestApproval) {
          // Loud, not silent: a missing provider is a wiring mistake, and a
          // mutation that quietly no-ops (or hangs forever waiting on a
          // modal nobody renders) is far harder to diagnose than this.
          throw new Error(
            'useApprovedMutation: no <ApprovalModalHostProvider> above this component — ' +
              'the approval prompt cannot be shown. Mount one at the app root.',
            { cause: error },
          );
        }
        const { approval_token } = await requestApproval({
          scope: approvalScope,
          passwordAllowed,
        });
        // A second APPROVAL_REQUIRED here is not caught — it propagates
        // as a normal error rather than looping back into the modal.
        return await mutationFn(variables, { headers: { 'X-Approval-Token': approval_token } });
      }
    },
  });
}
