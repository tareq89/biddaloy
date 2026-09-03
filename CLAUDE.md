# Biddaloy

A school management system. Multi-tenant. NestJS backend + React/Vite SPAs.

## Architecture reference

Before planning or implementing any new feature, read
[`docs/architecture/README.md`](docs/architecture/README.md) — it's a small
index into modular docs covering the domain model, auth/multi-tenancy,
backend modules, the fees/payments/invoices flow, communications, frontend
architecture, and deployment. Read only the specific doc relevant to the
task, not the whole set.

Package-specific conventions live in that package's own `CLAUDE.md` (e.g.
`server/CLAUDE.md` for NestJS testing standards) rather than here.

## Documentation style (always, for any doc in this repo)

Any time you write or edit documentation — root or package `README.md`,
`docs/architecture/*`, `CONTRIBUTING.md`, code comments meant to teach,
anything a human or another agent will read to understand the system —
it must be **dead simple to understand**:

- Prefer a diagram (Mermaid: `flowchart`, `sequenceDiagram`, `erDiagram`)
  over a paragraph whenever you're describing a flow, a relationship
  between things, or "what talks to what." If you catch yourself writing
  three or more sentences to describe a shape, draw it instead.
- Include a concrete example (a real request/response, a real file path, a
  real value) wherever the abstract description alone would leave the
  reader guessing what it looks like in practice.
- Write for someone who is not already an expert in this codebase. Define
  jargon on first use or don't use it. Short sentences over long ones.
- This does not mean dumbing down _accuracy_ — keep the technical rigor
  and the honest "why," including deviations from any prior plan — it
  means presenting it as plainly and visually as possible.

## RTK (Rust Token Killer)

Use `rtk` for shell commands whenever possible to reduce command-output tokens.

**Golden rule:** Prefix commands with `rtk`. If RTK has no dedicated filter,
it passes the command through unchanged.

```bash
rtk git status
rtk git diff
rtk vitest
rtk tsc
```

This also applies to command chains:

```bash
rtk git add . && rtk git commit -m "msg"
```

When unsure which RTK command or syntax to use, **look up the available
command and examples from RTK itself** rather than relying on a hardcoded
command list:

```bash
rtk --help
rtk <command> --help
```

Prefer the RTK equivalent for Git, tests, builds, linting, TypeScript,
package managers, file/search operations, Docker/Kubernetes, and other
supported commands.

Use `rtk proxy <cmd>` when raw/unfiltered output is specifically required.

## Additional token optimization practices

Beyond RTK, apply these techniques to keep every interaction lean.

### Navigation & file reading

- Prefer the `serena` MCP tools (`find_symbol`, `find_referencing_symbols`,
  `get_symbols_overview`, etc.) over `Read`/`Grep`/`Bash` for code search —
  they return targeted symbol matches instead of whole files.
- When `serena` isn't applicable, use `rg --files` or `git ls-files` instead
  of `find` or `ls -R`.
- Always filter JSON/API output with `jq` before showing it to the AI:

  ```bash
  curl -s api/endpoint | jq '.items[] | {id, name}'
  ```

### Command flags for less noise

- Use `--quiet`, `--no-color`, `--porcelain`, `--unified=0`, `-l`, etc. on
  every CLI tool when supported.
- For Git: `git diff --stat`, `git diff --unified=0`, `git status --porcelain`.
- For logs: `--fail-fast` and show only the first error.

### Batching commands

Combine independent commands into a single line to reduce round-trips:

```bash
rtk git status --porcelain && rtk git diff --stat
```

### AI response format

When summarising or explaining, prefer:

- Bullet points (≤5) instead of paragraphs.
- One-line summaries for each step.
- Output as JSON (e.g., `{file, line, message}`) when appropriate.

## Model & effort routing

Model choice and effort level set the price of every token, not just their
count — get these right before reaching for RTK/headroom/caveman to shave
output size.

- **Default to `/effort low`.** Escalate only for planning/architecture
  decisions or a task that's actually hard. Effort is session-wide and
  multiplies cost on every turn, so leaving it high by default taxes routine
  edits and fixes that never needed it.
- **Route by phase, not by session.** When a task splits into a
  cheap-to-get-wrong step (planning, architecture) and an
  expensive-to-get-wrong step (execution), pin each to its own model via a
  subagent (see `.claude/agents/`) instead of running the whole thing on
  whatever the session happens to be on. `implement-issue` /
  `implement-epic` are the reference implementation of this pattern.
- **Batch independent tool calls into one message.** This is the dominant
  cost term — bigger than prompt size. Every round trip re-reads the entire
  fixed context floor below, so two serial calls cost twice that floor while
  two batched calls cost it once.
- **Delegate exploration only when it's genuinely heavy.** A subagent pays
  the same ~50k floor the parent does, so a one-file lookup costs more
  delegated than done inline. Delegate when the dig would otherwise leave
  many intermediate reads in the parent's context for every later turn.
- **Prefer one warm session over frequent restarts.** Each new session
  re-writes the ~~53k prefix to cache (~~$0.21 at 1h TTL) before doing any
  work; a warm cache measured ~60% cheaper for identical context. Start
  fresh when the topic genuinely changes — not as a routine saving habit.

### Measured context floor (2026-09-03, this repo)

`claude -p "say ok" --output-format json`, total context for a trivial request:

| Config                      | Tokens |
| --------------------------- | ------ |
| Project + all 4 MCP servers | 52,949 |
| Project, MCP servers off    | 50,012 |
| Empty dir, no MCP           | 43,608 |

~43.6k is irreducible (Claude Code's system prompt, built-in tools, bundled
skills, user `CLAUDE.md`, memory). ~6.4k is project-level — this file, project
skills, graphify hook context. All four MCP servers together are only ~2.9k.

**This rules out skill/plugin trimming:** the skill listing is already capped
near 1% of context, so removing entries just redistributes that budget.
Disabling a whole plugin measured 52,948 vs 52,949 — no effect. Don't spend
effort there. Hooks are `command` type and cost latency, not tokens; the
exception is a hook that injects context (graphify's `hook-guard`), which
does add tokens to every matching tool call.

## Caveman Ultra

**MANDATORY: Use Caveman Ultra mode throughout every session in this project.**

At session start, activate:

```text
/caveman ultra
```

This governs conversational output only — code, tests, commit messages, PR
descriptions, and any plan or doc meant to be reviewed stay normal and
readable. When dispatching a subagent, tell it explicitly to run in
`/caveman ultra` too — subagents are separate contexts and don't inherit the
parent's mode unless told in the dispatch prompt.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
