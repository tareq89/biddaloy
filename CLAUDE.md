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

## Caveman Wenyan Ultra

**MANDATORY: Use Caveman Wenyan Ultra mode throughout every session in this project.**

At session start, activate:

```text
/caveman wenyan-ultra
```
