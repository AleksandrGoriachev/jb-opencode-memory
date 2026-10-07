---
description: Local memory store — status, save, recall, graph, lint.
---

Manage this repo's local agent memory (`.ai_agents/memory`). Follow the `memory`
skill for schema and rules.

User input: `$ARGUMENTS`

Dispatch on the first word:

- `status` or empty -> `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" status`
- `list ...` -> `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" list $ARGUMENTS`
- `search <q>` -> `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" search "<q>"`
- `recall <topic>` -> `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" recall "<topic>" --depth 2`
- `graph <id|title>` -> `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" graph "<id>" --depth 3`
- `lint` -> `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" lint`
- `save <text>` -> create a new frontmatter entry under the right
  `.ai_agents/memory/<kind>/` directory per the `memory` skill, link it with
  `related`/`supersedes`, then run `lint`.

Then summarize the result briefly. For `recall`/`graph`, report the connected
decision thread (entry id, kind, title, status) and the current truth when
superseded entries appear.
