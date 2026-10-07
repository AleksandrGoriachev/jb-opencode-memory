---
name: memory
description: Use when the task needs durable project context (decisions, preferences, architecture, facts) or the user says "remember", "recall", "what did we decide", "context", or "memory". Saves and graph-recalls from the local .ai_agents/memory markdown store.
---

# Memory (local markdown store + graph recall)

Long-term project memory lives in `.ai_agents/memory/<kind>/<title-slug>-<id>.md`
(gitignored, local). Markdown with flat YAML frontmatter is the source of truth.
The Node CLI `.opencode/memory/cli.mjs` (shared core `.opencode/memory/core.mjs`)
reads it and walks the link graph. The opencode plugin
(`.opencode/plugin/memory.js`) also auto-injects a memory guide + active
constraints each turn and writes raw session digests to `_digest/`.

## Recall (do this before answering about past decisions)

1. Graph recall by topic (searches titles/tags/body, then expands links):

   ```sh
   node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" recall "<topic>" --depth 2
   ```

2. Inspect the link tree from a known id, or list/search:

   ```sh
   node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" graph <id> --depth 3
   node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" search "<keyword>"
   node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" list --kind decisions --status active
   ```

3. Read the returned entries (they include superseded ones, marked by status).
   Prefer entries with higher `tier`/`importance`; an entry with
   `status: superseded` is history, not current truth — follow `supersededBy`.

The store is plain markdown, so opencode's own Grep/Glob/Read work on it
directly; the CLI only adds transitive link traversal. There is no database or
index — do not introduce one.

## Save (do this immediately after learning durable knowledge)

Create a new file under the matching `<kind>/` directory (kinds: `rules`,
`preferences`, `decisions`, `facts`, `architecture`, `concepts`). One idea per
entry; new prose in English; never store secrets. Frontmatter:

```yaml
---
id: m_<8-hex>
kind: decisions
tier: normal
status: active
scope: project
title: Short specific title
importance: 3
tags: [topic, area]
related: [m_...]
supersedes: []
supersededBy: []
depends: []
contradicts: []
createdAt: YYYY-MM-DD
updatedAt: YYYY-MM-DD
---
Self-contained body with concrete facts and `path:line` pointers.
```

Link the entry to existing ones via `related`/`depends` so the graph stays
connected. Do **not** ask the user for confirmation before saving.

## Supersede, never contradict

When a decision changes: create the new entry with `supersedes: [old-id]` and
edit the old entry to `status: superseded` plus `supersededBy: [new-id]`. Keep
it, don't delete.

## Housekeeping

Run `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" lint` after
editing to catch dangling links, duplicate ids and missing/invalid fields.

## Boundaries

This is agent memory for working in the repo — not part of the TV service. Never
mix it with application data (`api/services/*`, Redis results, DB schemas).
