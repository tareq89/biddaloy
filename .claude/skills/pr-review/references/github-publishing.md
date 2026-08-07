# Publishing the review to GitHub

The review isn't done until this step completes. Everything here uses `gh`,
already authenticated in this environment. Replace `<owner>/<repo>` and
`<n>` (PR number) throughout — get them from `gh repo view` and the PR you
identified at the start.

## 1. Get the head commit SHA

Inline review comments are anchored to a specific commit. Always use the
PR's **current head commit**, fetched fresh right before posting (not
whatever SHA you saw at the start of the review — the branch may have
moved):

```bash
HEAD_SHA=$(gh pr view <n> --json headRefOid -q .headRefOid)
```

## 2. Build one review with all inline comments

Post all inline comments as a **single review** (not one API call per
comment) — this avoids spamming the PR with individual notifications and
lets you submit the verdict atomically with the comments. Use the scratch
directory for the payload file.

Write the payload to
`/private/tmp/claude-501/-Users-muhammedtareqaziz-Workspace-personal-biddaloy/*/scratchpad/pr-<n>-review.json`
(use the actual scratchpad path given for this session), shaped like:

```json
{
  "commit_id": "<HEAD_SHA>",
  "body": "<overall review summary — 2-4 sentences on what this review covered and the verdict rationale>",
  "event": "REQUEST_CHANGES",
  "comments": [
    {
      "path": "server/src/students/students.service.ts",
      "line": 142,
      "side": "RIGHT",
      "body": "[HIGH] Missing tenant scoping on lookup\n\nProblem:\n...\n\nFailure scenario:\n...\n\nImpact:\n...\n\nRecommended fix:\n...\n\nRegression test:\n..."
    }
  ]
}
```

Notes on the payload:

- `event` is one of `APPROVE`, `COMMENT`, `REQUEST_CHANGES` — this is the
  verdict, decided per [finding-standards.md](finding-standards.md) /
  [SKILL.md](../SKILL.md), submitted in the same call as the comments.
- `line` is the line number **in the file as it exists after the diff**
  (i.e. the new-file line number you see in `gh pr diff`), with
  `side: "RIGHT"`. Use `side: "LEFT"` with the old-file line number only
  for a finding about a line that was *removed*.
- For a multi-line comment range, add `start_line` and `start_side`
  alongside `line`/`side`.
- If `comments` is empty (zero inline-attachable findings), omit the key
  entirely or pass an empty array — `body` and `event` alone are valid.
- Escape newlines as `\n` in the JSON string, or generate the file with a
  script/heredoc rather than hand-typing escapes.

Then submit it:

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  "repos/<owner>/<repo>/pulls/<n>/reviews" \
  --input /path/to/scratchpad/pr-<n>-review.json
```

Verify it landed:

```bash
gh pr view <n> --json reviews -q '.reviews[-1]'
```

## 3. General (non-inline) comments

For findings that can't be pinned to one changed line (migration ordering,
cross-file deploy-compatibility, CI/CD issues), either:

- include them in the `comments` array above with just `path` and no
  `line`, which GitHub renders as a file-level comment, or
- if a finding spans multiple files/components with no single anchor,
  fold it into the top-level `body` of the review payload, clearly listing
  the affected files, using the same Problem/Failure
  scenario/Impact/Recommended fix/Regression test structure from
  [finding-standards.md](finding-standards.md).

## 4. If you must post outside a formal review (rare)

A plain issue-style comment (no verdict, no inline anchor) is sometimes
useful for a purely informational note that isn't itself a finding:

```bash
gh pr comment <n> --body-file /path/to/scratchpad/pr-<n>-note.md
```

Prefer the review payload in step 2 for anything that is an actual
finding — it's what makes the verdict and the comments show up together
as one coherent review in the GitHub UI.

## 5. Re-review after the author pushes changes

If asked to re-review after updates: re-fetch the diff and head SHA, only
evaluate what changed since your last review plus whether prior findings
were actually addressed (check them off or re-raise if not), and submit a
**new** review rather than editing the old one — reviews are immutable
history.
