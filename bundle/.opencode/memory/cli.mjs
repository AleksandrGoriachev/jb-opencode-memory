#!/usr/bin/env node
// @ts-check
/**
 * Graph CLI over the local `.ai_agents/memory` markdown store.
 *
 * Usage:
 *   node .opencode/memory/cli.mjs status
 *   node .opencode/memory/cli.mjs list [--kind K] [--tier T] [--status S]
 *   node .opencode/memory/cli.mjs search <query> [--limit N]
 *   node .opencode/memory/cli.mjs graph <id-or-title> [--depth N]
 *   node .opencode/memory/cli.mjs recall <query> [--limit N] [--depth N] [--kind K]
 *   node .opencode/memory/cli.mjs lint
 *
 * Global: --root <dir> (default: <repo>/.ai_agents/memory)
 */
import { existsSync } from "node:fs"

import {
  bfs,
  buildGraph,
  entryId,
  entryKind,
  entryStatus,
  entryTier,
  entryTitle,
  findRoot,
  loadEntries,
  renderEntryLine,
  renderFullEntry,
  renderTree,
  resolveMemoryRoot,
  resolveSeed,
  searchScored,
} from "./core.mjs"

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--root":
        opts.root = argv[++i]
        break
      case "--kind":
        opts.kind = argv[++i]
        break
      case "--tier":
        opts.tier = argv[++i]
        break
      case "--status":
        opts.status = argv[++i]
        break
      case "--limit":
        opts.limit = Number(argv[++i])
        break
      case "--depth":
        opts.depth = Number(argv[++i])
        break
      default:
        if (arg.startsWith("--")) break
        opts._.push(arg)
    }
  }
  return opts
}

/** @param {ReturnType<typeof loadEntries>} entries @param {ReturnType<typeof buildGraph>} graph @param {string} root */
function cmdStatus(entries, graph, root) {
  const withId = entries.filter((entry) => entryId(entry))
  const active = withId.filter((entry) => entryStatus(entry) === "active").length
  /** @type {Record<string, number>} */
  const kinds = {}
  for (const entry of withId) kinds[entryKind(entry)] = (kinds[entryKind(entry)] ?? 0) + 1
  console.log(`root: ${root}`)
  console.log(`entries: ${withId.length} (${active} active)`)
  if (Object.keys(kinds).length > 0) {
    const rendered = Object.keys(kinds)
      .sort()
      .map((kind) => `${kind}=${kinds[kind]}`)
      .join(", ")
    console.log(`kinds: ${rendered}`)
  }
  console.log(`dangling links: ${graph.dangling.length}`)
  console.log(`duplicate ids: ${graph.duplicates.length}`)
  return 0
}

/** @param {ReturnType<typeof loadEntries>} entries @param {Record<string, any>} opts */
function cmdList(entries, opts) {
  const rows = entries.filter(
    (entry) =>
      entryId(entry) &&
      (!opts.kind || entryKind(entry) === opts.kind) &&
      (!opts.tier || entryTier(entry) === opts.tier) &&
      (!opts.status || entryStatus(entry) === opts.status),
  )
  if (rows.length === 0) {
    console.log("no entries")
    return 0
  }
  rows.sort((a, b) => entryKind(a).localeCompare(entryKind(b)) || entryTitle(a).toLowerCase().localeCompare(entryTitle(b).toLowerCase()))
  for (const entry of rows) console.log(renderEntryLine(entry))
  return 0
}

/** @param {ReturnType<typeof loadEntries>} entries @param {Record<string, any>} opts */
function cmdSearch(entries, opts) {
  const query = opts._.slice(1).join(" ")
  const results = searchScored(entries, query).slice(0, opts.limit ?? 10)
  if (results.length === 0) {
    console.log(`no matches for '${query}'`)
    return 0
  }
  for (const [score, entry] of results) console.log(`${String(score).padStart(4)}  ${renderEntryLine(entry)}`)
  return 0
}

/** @param {ReturnType<typeof buildGraph>} graph @param {Record<string, any>} opts */
function cmdGraph(graph, opts) {
  if (Object.keys(graph.byId).length === 0) {
    console.log("memory store is empty")
    return 0
  }
  const seed = resolveSeed(graph.byId, opts._.slice(1).join(" "))
  if (!seed.id) {
    if (seed.candidates.length > 0) {
      console.error("ambiguous seed; candidates:")
      for (const id of seed.candidates) console.error(`  ${renderEntryLine(graph.byId[id])}`)
    }
    return 1
  }
  for (const line of renderTree(graph.byId, graph.adjacency, seed.id, opts.depth ?? 3)) console.log(line)
  return 0
}

/** @param {ReturnType<typeof loadEntries>} entries @param {ReturnType<typeof buildGraph>} graph @param {Record<string, any>} opts */
function cmdRecall(entries, graph, opts) {
  const query = opts._.slice(1).join(" ")
  const candidates = entries.filter((entry) => entryId(entry) && (!opts.kind || entryKind(entry) === opts.kind))
  const results = searchScored(candidates, query)
  if (results.length === 0) {
    console.log(`no matches for '${query}'`)
    return 0
  }
  const limit = opts.limit ?? 3
  const depth = opts.depth ?? 2
  const seeds = results.slice(0, limit).map(([, entry]) => entryId(entry))
  const { order, edges } = bfs(graph.byId, graph.adjacency, seeds, depth)
  console.log(
    `recall '${query}': ${seeds.length} seed(s), ${order.length} entry(ies), ${edges.length} link(s), depth ${depth}\n`,
  )
  for (const id of order) {
    console.log(renderFullEntry(graph.byId[id]))
    console.log()
  }
  if (edges.length > 0) {
    console.log("links:")
    for (const [src, label, dst] of edges) console.log(`  ${src} --${label}--> ${dst}`)
  }
  return 0
}

/** @param {ReturnType<typeof loadEntries>} entries @param {ReturnType<typeof buildGraph>} graph */
function cmdLint(entries, graph) {
  let problems = 0
  for (const entry of entries) {
    if (!entryId(entry)) {
      console.log(`missing id: ${entry.path}`)
      problems++
    }
    for (const field of ["id", "kind", "tier", "status", "title"]) {
      const value = entry.data[field]
      if (value === undefined || value === null || value === "") {
        console.log(`missing '${field}': ${entry.path}`)
        problems++
      }
    }
    if (entryId(entry) && !["rules", "preferences", "decisions", "facts", "architecture", "concepts"].includes(entryKind(entry))) {
      console.log(`invalid kind '${entryKind(entry)}': ${entry.path}`)
      problems++
    }
    if (entryId(entry) && !["normal", "important", "immutable"].includes(entryTier(entry))) {
      console.log(`invalid tier '${entryTier(entry)}': ${entry.path}`)
      problems++
    }
    if (entryId(entry) && !["active", "superseded", "archived"].includes(entryStatus(entry))) {
      console.log(`invalid status '${entryStatus(entry)}': ${entry.path}`)
      problems++
    }
  }
  for (const dup of graph.duplicates) {
    console.log(`duplicate id ${dup}`)
    problems++
  }
  for (const [src, label, target] of graph.dangling) {
    console.log(`dangling link ${src} --${label}--> ${target}`)
    problems++
  }
  if (problems === 0) {
    console.log("lint clean")
    return 0
  }
  console.log(`\n${problems} problem(s)`)
  return 1
}

function main() {
  const argv = process.argv.slice(2)
  const opts = parseArgs(argv)
  const command = opts._[0]
  if (!command) {
    console.error("usage: cli.mjs <status|list|search|graph|recall|lint> [options]")
    return 2
  }
  const root = opts.root ? opts.root : resolveMemoryRoot(findRoot(process.cwd()))
  if (!existsSync(root)) {
    console.error(`memory root not found: ${root}`)
    return 2
  }
  const entries = loadEntries(root)
  const graph = buildGraph(entries)
  switch (command) {
    case "status":
      return cmdStatus(entries, graph, root)
    case "list":
      return cmdList(entries, opts)
    case "search":
      return cmdSearch(entries, opts)
    case "graph":
      return cmdGraph(graph, opts)
    case "recall":
      return cmdRecall(entries, graph, opts)
    case "lint":
      return cmdLint(entries, graph)
    default:
      console.error(`unknown command '${command}'`)
      return 2
  }
}

process.exit(main())
