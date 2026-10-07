# opencode-memory

Portable, per-project agent memory for [opencode](https://opencode.ai): a
markdown store with flat YAML frontmatter, a link graph for "recall the whole
decision thread", automatic system-prompt injection and raw session digests.
No database, no index.

## Layout

```
bundle/
  .opencode/
    .gitignore                 # node artifacts (node_modules, package.json, ...)
    plugin/memory.ts           # auto-discovered plugin (injection + digests)
    memory/core.mjs            # shared library (parser, store, graph, search, digest)
    memory/cli.mjs             # Node CLI: status|list|search|graph|recall|lint
    memory/VERSION
    skill/memory/SKILL.md      # auto-surfaced skill
    command/memory.md          # /memory command
  seed/memory-README.md        # store schema doc (seeded on install)
install.sh
```

The bundle vendors the same files opencode already auto-discovers, so **no
`opencode.json` change is needed**. The memory store itself lives at
`<project>/.ai_agents/memory/` and is **local/gitignored** (not shared).

## Install / update

```sh
./install.sh /path/to/project          # copy bundle into <project>/.opencode
./install.sh /path/to/project --force  # overwrite even if VERSION matches
```

Then commit the tooling in the project:

```sh
git -C /path/to/project add .opencode
git -C /path/to/project commit -m 'chore: vendor opencode-memory plugin'
```

Run the installer from a fresh `git pull` of this repo to update projects.

## Using it

- Recall: `node "$(git rev-parse --show-toplevel)/.opencode/memory/cli.mjs" recall "<topic>" --depth 2`
- Or the `/memory` command / the `memory` skill (the plugin also injects a guide each turn).
- The plugin is a no-op where `<project>/.ai_agents/memory/` does not exist.
- Requires **Node >= 18** for the CLI; the plugin runs on opencode's bundled Bun.

## Files

- Plugin: `bundle/.opencode/plugin/memory.ts` (imports `../memory/core.mjs`).
- Core: `bundle/.opencode/memory/core.mjs` (also imported by the CLI).
- CLI: `bundle/.opencode/memory/cli.mjs`.
- Skill: `bundle/.opencode/skill/memory/SKILL.md`.
- Command: `bundle/.opencode/command/memory.md`.

Store conventions and frontmatter schema: `bundle/seed/memory-README.md`.
