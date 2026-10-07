# Agent memory store (markdown + graph)

Local, agent-neutral, **gitignored** long-term memory for this repo. Markdown
pages are the source of truth. One shared JavaScript core
(`.opencode/memory/core.mjs`) backs both the Node CLI (`.opencode/memory/cli.mjs`)
and the opencode plugin (`.opencode/plugin/memory.ts`), so graph recall,
injection and digests never diverge.

**No database / no index.** Recall walks `related` / `supersedes` /
`supersededBy` / `depends` / `contradicts` links over the markdown pages; no
SQLite/FTS layer. Requires **Node ≥ 18** for the CLI (the plugin runs on
opencode's Bun).

The opencode plugin (when loaded) automatically injects a short memory guide
plus active high-value constraints into the system prompt, and writes raw
session digests to `_digest/` (see below).

## Layout

```
.ai_agents/memory/
  README.md                          # this file (skipped by the loader)
  <kind>/<title-slug>-<id>.md        # one memory entry per file
  _digest/<session-id>.md            # raw session digests (not entries)
.opencode/memory/core.mjs            # shared library
.opencode/memory/cli.mjs             # Node CLI: status|list|search|graph|recall|lint
.opencode/plugin/memory.ts           # opencode plugin: injection + digests
```

`<kind>` is one of: `rules`, `preferences`, `decisions`, `facts`,
`architecture`, `concepts`.

## Frontmatter schema (flat YAML)

```yaml
---
id: m_a1b2c3d4        # stable, unique; referenced by links
kind: decisions       # rules|preferences|decisions|facts|architecture|concepts
tier: important       # normal|important|immutable
status: active        # active|superseded|archived
scope: project        # project|user (metadata only)
title: Short specific title
importance: 4         # 1..5
tags: [periods, dto]  # free-form search tags
related: [m_b2c3d4e5] # undirected links to other entries
supersedes: []        # ids this entry replaces
supersededBy: []      # ids that replaced this entry
depends: []           # ids this entry depends on
contradicts: []       # ids this entry contradicts
createdAt: 2026-10-07
updatedAt: 2026-10-07
---
Body: self-contained facts, in English. Keep exactly one idea per entry.
```

## Rules

1. **One idea per entry**, self-contained (do not rely on chat history).
2. **Always set `id` and `kind`.** Link related entries by `id` under `related`.
3. **Supersede, never contradict.** When a decision changes, create a new entry
   with `supersedes: [old-id]` and set the old entry's `status: superseded`
   (add the new id to its `supersededBy`). Do not delete.
4. **Tiers resist forgetting:** `normal` < `important` < `immutable` (the latter
   for hard constraints that must never be dropped).
5. **No secrets.** Never store credentials or tokens.

## Graph recall

```sh
node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" status
node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" search "periods"
node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" recall "dto validation" --depth 2
node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" graph m_b2c3d4e5 --depth 3
node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" lint
```

`recall` searches titles/tags/body, then BFS-expands the top seeds across links
and prints the connected entries (the "entire picture"), including superseded
ones marked with their status. Run `lint` after editing to catch dangling links
and missing fields.

## Digests

The plugin records **user/assistant text only** (never tool calls/results or
injected context) per session and writes `_digest/<session-id>.md` on
`session.idle`, `session.compacted` and plugin dispose. Digest files have no
frontmatter, so the loader and `lint` ignore them.
