import { SetMetadata } from '@nestjs/common';
import { ApprovalScope } from '@biddaloy/shared';

export const REQUIRE_TWO_PERSON_KEY = 'requireTwoPerson';

export interface TwoPersonMetadata {
  scope: ApprovalScope;
  /** Small human-readable object the other owner sees. Never a secret. */
  summaryFn: (req: any) => Record<string, unknown>;
  /** No second active owner (or approvals switched off) means refuse, instead of letting it pass. */
  strict?: boolean;
}

/** [Epic 98] Gate a platform route behind the other owner's approval (see `TwoPersonGuard`). */
export const RequireTwoPerson = (
  scope: ApprovalScope,
  summaryFn: TwoPersonMetadata['summaryFn'] = () => ({}),
  strict = false,
) => SetMetadata(REQUIRE_TWO_PERSON_KEY, { scope, summaryFn, strict } satisfies TwoPersonMetadata);
