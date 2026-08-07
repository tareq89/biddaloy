# Finding standards — validation, severity, scope, format

Every candidate finding from Pass 1 and Pass 2 goes through this before it
is allowed anywhere near a GitHub comment.

## Validation gate

Before a finding may be reported, verify all of the following. If any fail,
drop the finding — do not downgrade it to a NIT to keep it alive.

1. The issue actually exists in the source code (re-read the exact lines; don't infer from a function name or a memory of "code like this usually has this bug").
2. The failure scenario is realistic, not purely theoretical.
3. The issue is relevant to this PR (see scope/causality below).
4. It is not already covered by an existing review comment (human or bot) — re-check the comments you pulled in step 1 of the workflow.
5. It is not a duplicate of another finding you're about to report.
6. The severity is justified by the definitions below, not inflated.
7. The recommended fix is concrete and actionable, not "consider looking into this."
8. The comment is understandable by the PR author without them needing this review's full context.

## PR scope / causality

Classify every surviving finding as one of:

- **introduced** — this PR's own new/changed code contains the bug.
- **exposed** — pre-existing code becomes reachable/dangerous *because of*
  this PR (e.g. a pre-existing missing tenant check on a service method
  that this PR newly calls from an unauthenticated context).
- **pre-existing** — the bug predates this PR and this PR doesn't change
  its reachability or risk.
- **unrelated** — not connected to this PR at all.

Only report **introduced** and **exposed** findings. For an exposed
finding, state the causal link explicitly in the comment ("this method had
no tenant check before, but this PR is the first caller that reaches it
with an unvalidated tenant ID").

Never report pre-existing or unrelated issues just because you noticed
them while reading surrounding code.

## Severity

- **BLOCKER** — severe security issue, data loss, data corruption, severe production outage, or a fundamental correctness failure. Must not merge as-is.
- **HIGH** — serious correctness, security, reliability, or data-integrity issue. Should be fixed before merge.
- **MEDIUM** — a real issue with meaningful impact, not necessarily merge-blocking.
- **LOW** — minor correctness, robustness, or maintainability concern.
- **NIT** — optional improvement.

Do not inflate severity to make a finding feel more important. Do not
deflate a real data-corruption risk to MEDIUM because the PR is otherwise
good.

## What is noise — never post these

- personal style/formatting preferences
- trivial refactoring suggestions
- speculative bugs you couldn't confirm in the code
- theoretical vulnerabilities with no realistic exploit path
- duplicates of an existing comment
- pre-existing/unrelated problems (see scope above)
- generic best-practice advice with no concrete problem attached to this diff

A review with zero findings is a completely acceptable, and often correct,
outcome.

## Testing philosophy for findings

Tests must protect *observable behavior*, not implementation. When
evaluating whether existing test coverage is adequate for a finding, or
when writing the "Regression test" line, prefer tests that cover:
authorization boundaries, business rules, API request/response behavior,
database invariants, concurrency, mutation/cache correctness, and
important user workflows — over tests that assert internal implementation
details and would still pass if the real bug came back.

For every BLOCKER or HIGH correctness/security finding, the comment should
include a specific regression test the author can write.

## Inline comment format

Attach to the smallest relevant *changed* line — prefer the line that
actually introduces the problem over a nearby line that merely uses it.
Don't attach to a line just because it's close by.

```
[<SEVERITY>] <Short descriptive title>

Problem:
<Exactly what is wrong.>

Failure scenario:
<A realistic, concrete example of how it fails.>

Impact:
<What happens in production if it fails.>

Recommended fix:
<The smallest appropriate actionable fix.>

Regression test:
<The test that should prevent recurrence — omit only for NIT/style-adjacent LOW findings.>
```

Keep it tight enough to read comfortably inside a GitHub review thread —
this is not a design doc.

## General (non-inline) PR comment format

Use when a finding genuinely can't be pinned to one changed line:
cross-file architectural issues, migration-ordering/deploy-compatibility
issues, CI/CD issues, repo-level config issues. Use the same
Problem/Failure scenario/Impact/Recommended fix/Regression test structure,
and explicitly list the affected files/components at the top since there's
no inline anchor to imply it.

## Full finding record (for internal tracking / final summary)

```markdown
### [SEVERITY] Short descriptive title

**Location:** `path/to/file.ts:123`

**Problem:**
Exactly what is wrong.

**Failure scenario:**
A realistic example showing how it fails.

**Impact:**
What happens if it fails.

**Recommended fix:**
The smallest appropriate actionable fix.

**Regression test:**
The test that should prevent recurrence.
```
