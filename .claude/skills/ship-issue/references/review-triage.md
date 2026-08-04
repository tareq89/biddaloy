# Triaging review findings

CodeRabbit is a strong reviewer that is sometimes wrong, sometimes right about a
problem but wrong about the fix, and sometimes right about something that
shouldn't be solved in this PR. Treating every finding as a command produces
churn and bad code; treating them all as noise misses real bugs. The job is to
decide, per finding, and be able to defend the decision.

## Verify before you act

Findings are generated against a diff and go stale as you push. Before touching
anything, confirm the finding still describes the current code. A thread can
also be about code you already fixed in a later commit.

Prefer reproducing over reasoning when the claim is about runtime or data
behavior. A finding you reproduce is a finding you fix correctly; a finding you
only reason about is one you might "fix" in the wrong place.

The clearest example from PR #55: CodeRabbit said the `tenant_id` migration
would fail on rows with neither `student_id` nor `guardian_id`. Rather than
assume, seed exactly that row and run it:

```
ERROR: column "tenant_id" of relation "communication_logs" contains null values
```

That took two minutes, converted a plausible claim into a certainty, and gave a
concrete before/after to cite in the reply. It also revealed *why* the original
smoke test missed it — the table was empty.

## The three outcomes

**Fix it.** Real defect, in scope. Correctness, security, data integrity, and
contract violations land here. Fix the root cause, add a test that would have
caught it, and reply saying what changed.

**Push back.** The finding is wrong, or its suggested fix is worse than what's
there. Say so plainly with technical reasoning. This is a normal outcome, not a
confrontation — a reviewer that's right 85% of the time needs you to catch the
other 15%, and silently complying with a wrong suggestion degrades the codebase.

**Defer.** Real, but disproportionate to this PR — a rearchitecture, or a fix
that needs infrastructure that doesn't exist yet. Document the limitation in
code so it isn't an invisible assumption, explain the reasoning in the thread,
and offer a follow-up issue. Leave these **unresolved** so a human decides.

## Resolve vs. leave open

Resolve threads you fixed and threads you're confident are wrong — with a reply
explaining why in both cases. Leave judgment calls open: anything where a
maintainer might reasonably overrule you. "No open threads" should mean "nothing
left to decide", so parking your own debatable calls in the resolved pile
defeats the purpose of the check.

## Worked examples from PR #55

**Fixed — retries never fired.** "Retryable provider failures are treated as
success." Correct and subtle: the processor recorded the failure and returned
normally, which BullMQ treats as a completed job, so `attempts`/`backoff` never
engaged. The queue looked configured for retries and did none. Fixed by throwing
on retryable failure and marking FAILED only once attempts are exhausted.

**Fixed — cross-tenant read.** Tenancy was derived from an *optional* relation,
so a freeform log with no student or guardian was readable by any tenant. Added
a real `tenant_id` column plus migration.

**Fixed — contract violation.** The Messenger stub threw `NotImplementedException`
while the provider interface promised never to throw, so its rows stuck in
QUEUED. Returned a failure result instead, and added a `try/catch` in the
processor as defense-in-depth against the next provider that gets this wrong.

**Pushed back — controller RBAC tests.** The ask was per-role allow/deny
assertions on the controller. But `@Roles`/`ContextGuard` don't execute when a
controller is constructed directly in a unit test, so those assertions would
pass no matter what the decorators said — a test that cannot fail is worse than
no test, because it reads like coverage. The repo already tests guards centrally.
Explained, offered e2e coverage as the alternative that would actually work.

**Pushed back — `attempts: 4`.** Factually right that `attempts` includes the
initial run, so `3` means two retries. But the config wasn't the bug; the PR
description's wording was. 1 + 2 retries with exponential backoff is a fine
default, so the honest reply corrects the description and leaves the config,
noting it's a one-character change if the maintainer prefers otherwise.

**Deferred — send idempotency.** Genuine at-least-once gap: provider accepts,
process dies before the save, retry re-sends. Closing it needs provider-side
dedup keys that Greenweb, MimSMS, and SMTP don't uniformly offer. Documented the
semantics in a class comment, left the thread open for a maintainer.

## Reply tone

Write for the human who reads the thread in six months. State the outcome, the
reasoning, and the evidence. Concede when the reviewer is right — "good catch,
this was a real failure, here's the reproduction" is the correct response to a
real bug, and it builds the credibility that makes your pushback land when you
disagree. Skip both defensiveness and reflexive agreement.
