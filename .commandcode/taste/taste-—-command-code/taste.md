# Taste — Command Code
- Wants subagents run visibly in the foreground, not as background jobs — "i want to see the subagents working, not in the background"; corrects with "i dont see you working". Confidence: 0.9
- Working in an isolated git worktree is enough authorization to commit and push — don't stop to ask ("arent you working in a isolated git worktree? in that case just commit and push"). Confidence: 0.85
- On a large codebase, explicitly wants subagents used to avoid context maxing and hallucinations rather than one huge pass. Confidence: 0.75
- Prefers bounded attempts on automatable ops (e.g. fix conflict and push): "try only once, if fail, tell me how to push it manually" — stop after a single failure and hand back manual instructions instead of retrying. Confidence: 0.75
- Wants git operations performed in the current folder/checkout, not spun up in a separate worktree ("do it in the current folder, not a worktree"). Confidence: 0.7
- Expects complete test coverage of any implementation: unit, integration, e2e and smoke tests — not just one layer ("i am expecting you will be writing correct unit, integration, e2e, smoke test for these implementations"). Confidence: 0.8
- Always ignore the known-generated dirty files (`.serena/project.yml`, `mockServiceWorker.js` churn) in preflight instead of stopping the run — "alaways ignore it". Confidence: 0.75
- Expects shell commands (yarn lint/typecheck/test etc.) to run through the `rtk` wrappers, not plain — caught it mid-task: "you are using rtk right?" when plain `yarn ...` had been used. Confidence: 0.7
