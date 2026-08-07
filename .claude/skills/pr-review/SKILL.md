---
name: pr-review
description: Perform a rigorous Senior/Staff-level review of an existing GitHub Pull Request in this repo (NestJS/Node/TypeScript backend, React frontend, PostgreSQL, CI/CD) and publish the findings as real inline GitHub review comments plus an overall review verdict. Use whenever the user asks to review a PR, "review PR #N", do a code review of an open pull request, check whether a PR is safe to merge, or wants a second opinion before merging. Two independent review passes are mandatory before anything is posted, and a clean PR gets zero findings and an APPROVE — not manufactured comments. Not for reviewing your own uncommitted working diff — that's /code-review.
---

# PR review

Review an existing GitHub Pull Request the way the engineer who will get
paged at 3 AM for it would review it. The question being answered is never
"is this PR good" — it is **"is this PR safe to merge?"**

Optimize for correctness, security, data integrity, reliability, production
safety, maintainability, performance, test coverage, and deployment safety.
Do **not** optimize for comment count. A PR with real findings gets real
findings; a clean PR gets zero. Noise erodes trust in every future review
this skill produces — a false-positive HIGH is worse than a missed NIT.

This skill's output is not a chat message. It is a published GitHub review:
inline comments on the exact lines, a verdict (`APPROVE` /
`COMMENT` / `REQUEST_CHANGES`), and then a short summary back to the user.

## Before starting

Confirm `gh` is authenticated and identify the repo and PR:

```bash
gh auth status
gh repo view --json nameWithOwner -q .nameWithOwner
```

If the user named a PR number, use it. If they didn't, ask which PR, or if
they said something like "review the PR I just opened", find it:

```bash
gh pr list --author "@me" --state open --limit 10
```

Never guess a PR number.

## The workflow

Follow this order. Do not post anything to GitHub until step 16 — everything
before that is research and analysis.

### 1. Gather everything before reading a single diff line

```bash
gh pr view <n> --json title,body,author,baseRefName,headRefName,commits,state,mergeable,reviews,statusCheckRollup
gh pr view <n> --comments
gh pr diff <n>
gh api repos/{owner}/{repo}/pulls/<n>/commits
gh api repos/{owner}/{repo}/pulls/<n>/comments   # existing inline review comments
gh pr checks <n>
```

Read the title, description, and any linked issue. Read every existing
review comment and inline comment — human or bot (CodeRabbit, etc.). You
must not duplicate a finding someone already made. If an existing comment
is incomplete or wrong, only add to it if you have materially new
information.

Read the commit list — a PR that "fixed the bug" in commit 3 after
introducing it in commit 1 still needs the intermediate state considered
if it affects deploy safety (see rollout analysis in
[references/pass-2-adversarial.md](references/pass-2-adversarial.md)).

### 2. Understand the repo, not just the diff

The diff is never the full picture. Before forming opinions, inspect the
surrounding code the diff touches: the module/service/controller/component
it lives in, its callers, its tests, shared types it depends on (especially
`shared/` in this workspace, which both `server` and the `client-*` /`ui`
packages consume), relevant guards/interceptors/pipes, and relevant
migrations. If you're unsure how deep to go, use the Explore agent for
broad discovery rather than guessing from the diff alone.

Do not report a single finding until you understand:
- what problem the PR solves
- what behavior it adds or changes
- what behavior must stay unchanged
- what assumptions the implementation is making
- which parts of the app (backend, frontend, db, CI) are actually affected

### 3. Pass 1 — structural/engineering review

Independent, full pass. Answers: *does this implementation correctly solve
the intended problem within this repo's architecture?*

Full checklist (correctness, NestJS/backend, PostgreSQL/migrations, React,
TypeScript, security, performance, reliability, testing, CI/CD) is in
[references/pass-1-structural.md](references/pass-1-structural.md). Read it
now and work through every section relevant to the files changed — skip
sections only when genuinely inapplicable (e.g. skip PostgreSQL section for
a CSS-only PR), not because the PR "looks small."

### 4. Pass 2 — adversarial/failure-oriented review

A **second, independent** pass. Do not just re-skim Pass 1's notes — assume
Pass 1 missed something and actively try to break the implementation:
malformed input, authorization bypass, race conditions, database failure
modes, API failure modes, frontend stale-state, production-scale data, and
partial/rolling deployment. Full scenario list is in
[references/pass-2-adversarial.md](references/pass-2-adversarial.md).

Pass 2 is mandatory even when the PR is test-only, tiny, CI is green, or
the author is senior. Those are exactly the conditions under which subtle
bugs slip through Pass 1.

### 5. Validate and de-duplicate findings

For every candidate finding, before it's allowed to become a comment, run
it through the validation gate in
[references/finding-standards.md](references/finding-standards.md):
confirm it actually exists in the code, is realistic (not theoretical),
is caused/exposed by *this* PR (not pre-existing and unrelated), isn't a
duplicate of an existing comment, has a justified severity, and has an
actionable fix. Anything that fails validation gets dropped, not
downgraded into a NIT to preserve it.

Classify each surviving finding as introduced / exposed / pre-existing /
unrelated by this PR. Only introduced and exposed findings get reported;
if a pre-existing issue becomes newly reachable because of this PR,
report it and explain the causal link.

Assign severity (BLOCKER / HIGH / MEDIUM / LOW / NIT) per the definitions
in [references/finding-standards.md](references/finding-standards.md). Do
not inflate.

### 6. Publish to GitHub

This is the deliverable. Use the `gh api` recipes in
[references/github-publishing.md](references/github-publishing.md) to:

1. Post one inline comment per finding, attached to the smallest relevant
   changed line, using the exact format in
   [references/finding-standards.md](references/finding-standards.md).
2. Post general (non-inline) PR comments for findings that span files or
   can't be meaningfully pinned to one line (migration ordering,
   deploy-compatibility, CI/CD issues).
3. Submit one overall review verdict:
   - `REQUEST_CHANGES` — at least one BLOCKER or HIGH.
   - `COMMENT` — substantive MEDIUM/LOW findings, but nothing merge-blocking.
   - `APPROVE` — no blocking or substantive findings. Never approve just
     because CI is green, tests pass, or the diff is small — those are
     inputs to the review, not a substitute for it.

Do not modify the PR's code, push commits, or fix findings yourself unless
the user explicitly asks you to. Your default job ends at
review → comment → verdict.

### 7. Summarize to the user

After publishing, reply in chat with:

```markdown
# PR Review Complete

## Verdict
<APPROVE | COMMENT | REQUEST_CHANGES>

## Findings Posted
- BLOCKER: n
- HIGH: n
- MEDIUM: n
- LOW: n
- NIT: n

## Key Issues
<2-5 bullets on the most important findings, if any>

## GitHub Review
Posted to <PR URL>.
```

If there were zero findings: say so plainly — "No blocking or substantive
issues found. The PR was reviewed and approved." Do not repeat the full
review in chat once it's posted to GitHub; link to it.

## Quality gate — check before submitting the review

- [ ] PR intent understood from title/description/linked issue, not guessed from the diff alone
- [ ] Existing review comments (human and bot) read and not duplicated
- [ ] Surrounding code inspected, not just changed lines
- [ ] Pass 1 (structural) completed
- [ ] Pass 2 (adversarial) completed **independently**, not merged into Pass 1
- [ ] Authorization explicitly checked, not assumed from authentication
- [ ] Every finding has a concrete failure scenario and an actionable fix
- [ ] Every finding classified introduced/exposed/pre-existing/unrelated — only introduced/exposed reported
- [ ] Severity matches the definitions, not inflated
- [ ] Speculative, theoretical, style-only, and duplicate findings dropped
- [ ] Inline comments used where a line applies; general comments only where it doesn't
- [ ] Verdict submitted (`APPROVE`/`COMMENT`/`REQUEST_CHANGES`) — review isn't done until this posts
- [ ] No source code modified unless the user explicitly asked for fixes
