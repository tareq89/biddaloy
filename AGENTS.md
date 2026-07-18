## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships. Use it for broad architecture questions or cross-module relationships.

### For codebase questions

When the question is about **cross-module relationships, architecture overview, or community structure**:
1. Check if `graphify-out/graph.json` exists
2. If yes, run `graphify query "<question>"` first
3. Use `graphify path "<A>" "<B>"` for relationships between modules

For **narrow questions** (e.g. "what does this function do?", "how is this entity defined?", "fix this bug"), skip graphify and go directly to source files — it's faster and avoids loading the full graphify skill.

### For graph lifecycle

- **Before any git commit:** run `graphify . --update` first, then commit
- **Dirty** graphify-out/ files are expected after incremental updates
