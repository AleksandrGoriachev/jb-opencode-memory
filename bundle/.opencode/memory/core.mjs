// @ts-check
/**
 * Shared core for the local `.ai_agents/memory` markdown store.
 *
 * Markdown pages with flat YAML frontmatter are the source of truth. This
 * module is dependency-free and side-effect-free: it exposes frontmatter
 * parsing, entry loading, the link graph (BFS "recall"), search/ranking,
 * rendering, session digests and the system-prompt section. It is imported by
 * both the Node CLI (`.opencode/memory/cli.mjs`) and the opencode plugin
 * (`.opencode/plugin/memory.ts`), so the two never diverge.
 *
 * Works on Node >= 18 and on Bun (uses only node:fs / node:path).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const LINK_KEYS = ["related", "supersedes", "supersededBy", "depends", "contradicts"]
export const REQUIRED = ["id", "kind", "tier", "status", "title"]
export const KINDS = new Set(["rules", "preferences", "decisions", "facts", "architecture", "concepts"])
export const TIERS = new Set(["normal", "important", "immutable"])
export const STATUSES = new Set(["active", "superseded", "archived"])
export const EDGE_MARK = {
  supersedes: "!",
  supersededBy: "^",
  depends: ">",
  contradicts: "x",
  related: "-",
}

/** Directory (inside the memory root) that holds raw session digests. */
export const DIGEST_DIR = "_digest"

const FRONT_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/

// --------------------------------------------------------------------------- //
// frontmatter parsing
// --------------------------------------------------------------------------- //

/**
 * Parse a flat YAML scalar or inline array (`[a, b]`).
 * @param {string} raw
 * @returns {string | number | boolean | string[]}
 */
export function parseValue(raw) {
  const value = String(raw ?? "").trim()
  if (value.length === 0) return ""
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    if (inner.length === 0) return []
    /** @type {string[]} */
    const out = []
    let current = ""
    /** @type {string | null} */
    let quote = null
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]
      if (quote) {
        if (char === "\\" && i + 1 < inner.length) {
          current += inner[i + 1]
          i++
          continue
        }
        if (char === quote) quote = null
        else current += char
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === ",") {
        out.push(current.trim())
        current = ""
        continue
      }
      current += char
    }
    if (current.trim().length > 0) out.push(current.trim())
    return out.map((item) => item.replace(/^["']|["']$/g, "")).filter((item) => item.length > 0)
  }
  if (value.toLowerCase() === "true") return true
  if (value.toLowerCase() === "false") return false
  return value.replace(/^["']|["']$/g, "")
}

/**
 * Split a markdown page into frontmatter data and body.
 * @param {string} text
 * @returns {{ data: Record<string, unknown>, body: string } | null}
 */
export function parseFrontmatter(text) {
  const match = FRONT_RE.exec(text)
  if (!match) return null
  /** @type {Record<string, unknown>} */
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const km = KEY_RE.exec(line.trim())
    if (!km) continue
    data[km[1]] = parseValue(km[2])
  }
  return { data, body: text.slice(match[0].length).trim() }
}

// --------------------------------------------------------------------------- //
// store + graph
// --------------------------------------------------------------------------- //

/** @typedef {{ path: string, data: Record<string, any>, body: string }} MemoryEntry */

/** Recursively collect `*.md` files, skipping `_digest/`. @param {string} dir */
function walkMarkdown(dir) {
  /** @type {string[]} */
  const out = []
  /** @type {import("node:fs").Dirent[]} */
  let dirents = []
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const dirent of dirents) {
    const full = join(dir, dirent.name)
    if (dirent.isDirectory()) {
      if (dirent.name === DIGEST_DIR) continue
      out.push(...walkMarkdown(full))
    } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith(".md")) {
      out.push(full)
    }
  }
  return out
}

/**
 * Load all memory entries under a store root.
 * @param {string} root
 * @returns {MemoryEntry[]}
 */
export function loadEntries(root) {
  if (!existsSync(root)) return []
  /** @type {MemoryEntry[]} */
  const entries = []
  for (const file of walkMarkdown(root).sort()) {
    const name = file.split(/[\\/]/).pop() ?? ""
    if (name.toLowerCase() === "readme.md") continue
    let text
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const parsed = parseFrontmatter(text)
    if (!parsed) continue
    entries.push({ path: file, data: parsed.data, body: parsed.body })
  }
  return entries
}

/** @param {MemoryEntry} entry */
export function entryId(entry) {
  return String(entry.data.id ?? "")
}
/** @param {MemoryEntry} entry */
export function entryTitle(entry) {
  return String(entry.data.title ?? "(untitled)")
}
/** @param {MemoryEntry} entry */
export function entryKind(entry) {
  return String(entry.data.kind ?? "?")
}
/** @param {MemoryEntry} entry */
export function entryTier(entry) {
  return String(entry.data.tier ?? "normal")
}
/** @param {MemoryEntry} entry */
export function entryStatus(entry) {
  return String(entry.data.status ?? "active")
}
/** @param {MemoryEntry} entry */
export function entryUpdated(entry) {
  return String(entry.data.updatedAt ?? "")
}
/** @param {MemoryEntry} entry @returns {string[]} */
export function entryTags(entry) {
  const value = entry.data.tags
  if (Array.isArray(value)) return value.map(String)
  return value ? [String(value)] : []
}
/** @param {MemoryEntry} entry @returns {[string, string][]} */
export function entryLinks(entry) {
  /** @type {[string, string][]} */
  const out = []
  for (const key of LINK_KEYS) {
    const value = entry.data[key]
    const targets = Array.isArray(value) ? value : value ? [value] : []
    for (const target of targets) out.push([key, String(target)])
  }
  return out
}

/**
 * Build the id-keyed graph with symmetric links.
 * @param {MemoryEntry[]} entries
 */
export function buildGraph(entries) {
  /** @type {Record<string, MemoryEntry>} */
  const byId = {}
  /** @type {string[]} */
  const duplicates = []
  for (const entry of entries) {
    const id = entryId(entry)
    if (!id) continue
    if (byId[id]) duplicates.push(id)
    else byId[id] = entry
  }
  /** @type {Record<string, [string, string][]>} */
  const adjacency = {}
  for (const id of Object.keys(byId)) adjacency[id] = []
  /** @type {[string, string, string][]} */
  const dangling = []
  for (const entry of entries) {
    const id = entryId(entry)
    if (!id) continue
    for (const [label, target] of entryLinks(entry)) {
      if (byId[target]) {
        adjacency[id].push([label, target])
        const back = label === "supersedes" ? "supersededBy" : label === "supersededBy" ? "supersedes" : label
        adjacency[target].push([back, id])
      } else {
        dangling.push([id, label, target])
      }
    }
  }
  return { byId, adjacency, duplicates, dangling }
}

/** @param {[string, string, string][]} edges */
export function uniqueByPair(edges) {
  const seen = new Set()
  /** @type {[string, string, string][]} */
  const out = []
  for (const [src, label, dst] of edges) {
    const canonical = label === "supersedes" || label === "supersededBy" ? "supersedes" : label
    const key = [canonical, ...[src, dst].sort()].join("\u0000")
    if (seen.has(key)) continue
    seen.add(key)
    out.push([src, label, dst])
  }
  return out
}

/**
 * Breadth-first expansion from seed ids.
 * @param {Record<string, MemoryEntry>} byId
 * @param {Record<string, [string, string][]>} adjacency
 * @param {string[]} seeds
 * @param {number} depth
 */
export function bfs(byId, adjacency, seeds, depth) {
  const seen = new Set()
  /** @type {string[]} */
  const order = []
  /** @type {[string, string, string][]} */
  const edges = []
  /** @type {[string, number][]} */
  const queue = []
  for (const seed of seeds) {
    if (byId[seed] && !seen.has(seed)) {
      seen.add(seed)
      order.push(seed)
      queue.push([seed, 0])
    }
  }
  while (queue.length > 0) {
    const [node, level] = queue.shift()
    if (level >= depth) continue
    for (const [label, nxt] of adjacency[node] ?? []) {
      edges.push([node, label, nxt])
      if (!seen.has(nxt)) {
        seen.add(nxt)
        order.push(nxt)
        queue.push([nxt, level + 1])
      }
    }
  }
  return { order, edges: uniqueByPair(edges) }
}

// --------------------------------------------------------------------------- //
// rendering
// --------------------------------------------------------------------------- //

/** @param {MemoryEntry} entry */
export function renderEntryLine(entry) {
  let markers = ""
  if (entryTier(entry) === "immutable") markers += " [immutable]"
  else if (entryTier(entry) === "important") markers += " [important]"
  if (entryStatus(entry) !== "active") markers += ` [${entryStatus(entry)}]`
  return `${entryId(entry)}  [${entryKind(entry)}] ${entryTitle(entry)}${markers}  (${entryUpdated(entry)})`
}

/** @param {MemoryEntry} entry */
export function renderFullEntry(entry) {
  const links = entryLinks(entry).map(([k, t]) => `${k}->${t}`).join(", ") || "none"
  return `=== ${renderEntryLine(entry)} ===\nlinks: ${links}\n\n${entry.body}`.replace(/\s+$/, "")
}

/**
 * @param {Record<string, MemoryEntry>} byId
 * @param {Record<string, [string, string][]>} adjacency
 * @param {string} seed
 * @param {number} depth
 */
export function renderTree(byId, adjacency, seed, depth) {
  /** @type {string[]} */
  const lines = [`* ${renderEntryLine(byId[seed])}`]
  const visited = new Set([seed])
  /** @param {string} node @param {string} prefix @param {number} level */
  const walk = (node, prefix, level) => {
    for (const [label, child] of adjacency[node] ?? []) {
      if (visited.has(child) || !byId[child]) continue
      visited.add(child)
      const mark = EDGE_MARK[label] ?? "-"
      lines.push(`${prefix}${mark} ${label.padEnd(13)} ${renderEntryLine(byId[child])}`)
      if (level + 1 < depth) walk(child, prefix + "  ", level + 1)
    }
  }
  walk(seed, "  ", 0)
  return lines
}

// --------------------------------------------------------------------------- //
// search
// --------------------------------------------------------------------------- //

/**
 * Rank entries by a query over title (x3), tags (x2) and body (x1).
 * @param {MemoryEntry[]} entries
 * @param {string} query
 * @returns {[number, MemoryEntry][]}
 */
export function searchScored(entries, query) {
  const tokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 0)
  /** @type {[number, MemoryEntry][]} */
  const results = []
  for (const entry of entries) {
    const title = entryTitle(entry).toLowerCase()
    const tags = entryTags(entry).join(" ").toLowerCase()
    const body = entry.body.toLowerCase()
    let score = 0
    for (const token of tokens) {
      score += 3 * countOccurrences(title, token)
      score += 2 * countOccurrences(tags, token)
      score += countOccurrences(body, token)
    }
    if (score > 0) results.push([score, entry])
  }
  results.sort((a, b) => b[0] - a[0] || entryId(a[1]).localeCompare(entryId(b[1])))
  return results
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Resolve a user-supplied id or title fragment to an entry id.
 * @param {Record<string, MemoryEntry>} byId
 * @param {string} needle
 * @returns {{ id: string | null, candidates: string[] }}
 */
export function resolveSeed(byId, needle) {
  if (byId[needle]) return { id: needle, candidates: [needle] }
  const low = needle.toLowerCase()
  for (const [id, entry] of Object.entries(byId)) {
    if (entryTitle(entry).toLowerCase() === low) return { id, candidates: [id] }
  }
  const matches = Object.keys(byId).filter((id) => entryTitle(byId[id]).toLowerCase().includes(low))
  if (matches.length === 1) return { id: matches[0], candidates: matches }
  return { id: null, candidates: matches }
}

// --------------------------------------------------------------------------- //
// paths
// --------------------------------------------------------------------------- //

/** Walk up from `start` to the repo root holding `.ai_agents` or `AGENTS.md`. */
export function findRoot(start) {
  let current = resolve(start)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(current, ".ai_agents")) || existsSync(join(current, "AGENTS.md"))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return resolve(start)
}

/** Absolute memory root for a base directory. */
export function resolveMemoryRoot(base) {
  return join(resolve(base), ".ai_agents", "memory")
}

// --------------------------------------------------------------------------- //
// session digests (raw user/assistant text)
// --------------------------------------------------------------------------- //

/** Sanitize a session id into a safe digest file name. */
export function digestFileName(sessionId) {
  const safe = String(sessionId ?? "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
  return `${safe.length > 0 ? safe : "session"}.md`
}

/** @typedef {{ role: string, created: number, order: number, parts: Map<string, string> }} DigestMessage */

export class DigestBuffer {
  /** @param {string} root @param {(message: string) => void} [warn] */
  constructor(root, warn = () => {}) {
    this.dir = join(root, DIGEST_DIR)
    this.warn = warn
    /** @type {Map<string, { messages: Map<string, DigestMessage>, seq: number }>} */
    this.sessions = new Map()
  }

  /** @param {string} sessionId */
  path(sessionId) {
    return join(this.dir, digestFileName(sessionId))
  }

  /** @param {{ sessionID: string, messageID: string, role: string, created?: number }} input */
  recordMessage({ sessionID, messageID, role, created }) {
    if (!sessionID || !messageID) return
    const session = this.session(sessionID)
    let message = session.messages.get(messageID)
    if (!message) {
      message = { role, created: Number(created) || 0, order: session.seq++, parts: new Map() }
      session.messages.set(messageID, message)
    }
    message.role = role || message.role
    if (created) message.created = Number(created)
  }

  /** @param {{ sessionID: string, messageID: string, partID: string, text: string }} input */
  recordText({ sessionID, messageID, partID, text }) {
    if (!sessionID || !messageID || !partID) return
    const value = String(text ?? "")
    if (value.length === 0) return
    const session = this.session(sessionID)
    let message = session.messages.get(messageID)
    if (!message) {
      message = { role: "unknown", created: 0, order: session.seq++, parts: new Map() }
      session.messages.set(messageID, message)
    }
    message.parts.set(partID, value)
  }

  /** @param {string} sessionID */
  drop(sessionID) {
    this.sessions.delete(sessionID)
  }

  /** @returns {boolean} true when a file was written. */
  flush(sessionID) {
    const session = this.sessions.get(sessionID)
    if (!session) return false
    const blocks = [...session.messages.entries()]
      .map(([messageID, message]) => ({
        messageID,
        role: message.role || "unknown",
        created: message.created,
        order: message.order,
        text: [...message.parts.values()].join("\n").trim(),
      }))
      .filter((block) => block.text.length > 0)
      .sort((a, b) => (a.created || 0) - (b.created || 0) || a.order - b.order)
    if (blocks.length === 0) return false
    const content =
      blocks
        .map((block) => `## ${block.role} (${new Date(block.created || Date.now()).toISOString()})\n\n${block.text}`)
        .join("\n\n") + "\n"
    return this.write(this.path(sessionID), content)
  }

  flushAll() {
    for (const sessionID of [...this.sessions.keys()]) this.flush(sessionID)
  }

  /** @param {string} sessionID */
  session(sessionID) {
    let session = this.sessions.get(sessionID)
    if (!session) {
      session = { messages: new Map(), seq: 0 }
      this.sessions.set(sessionID, session)
    }
    return session
  }

  /** @param {string} file @param {string} content */
  write(file, content) {
    try {
      mkdirSync(this.dir, { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tmp, content, "utf8")
      renameSync(tmp, file)
      return true
    } catch (error) {
      try {
        unlinkSync(`${file}.${process.pid}.${Date.now()}.tmp`)
      } catch {
        /* ignore */
      }
      this.warn(`Failed to flush digest "${file}": ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
}

// --------------------------------------------------------------------------- //
// system-prompt section
// --------------------------------------------------------------------------- //

/** Short autonomous-memory guide injected into the system prompt every turn. */
export const GUIDE = [
  "Local project memory (`.ai_agents/memory/`, gitignored) is available and autonomous.",
  '- Recall before answering about decisions, preferences, architecture or earlier work: `node .opencode/memory/cli.mjs recall "<topic>" --depth 2` (or Grep/Read the store directly).',
  "- Save durable knowledge with the `memory` skill (supersede outdated entries, never store secrets).",
].join("\n")

/**
 * Build the injected system-prompt section: the guide plus active high-value
 * constraints (rules / immutable / important), capped.
 * @param {MemoryEntry[]} entries
 * @param {{ limit?: number, bodyChars?: number }} [options]
 * @returns {string}
 */
export function buildSystemSection(entries, options = {}) {
  const limit = options.limit ?? 8
  const bodyChars = options.bodyChars ?? 300
  const tierRank = { immutable: 0, important: 1, normal: 2 }
  const constraints = entries
    .filter((entry) => {
      if (!entryId(entry) || entryStatus(entry) !== "active") return false
      return entryKind(entry) === "rules" || entryTier(entry) === "immutable" || entryTier(entry) === "important"
    })
    .sort((a, b) => {
      const tier = (tierRank[entryTier(a)] ?? 2) - (tierRank[entryTier(b)] ?? 2)
      if (tier !== 0) return tier
      return entryUpdated(b).localeCompare(entryUpdated(a))
    })
    .slice(0, limit)

  const parts = [GUIDE]
  if (constraints.length > 0) {
    const lines = constraints.map((entry) => {
      const body = entry.body.replace(/\s+/g, " ").trim().slice(0, bodyChars)
      return `- [${entryId(entry)}][${entryTier(entry)}][${entryKind(entry)}] ${entryTitle(entry)} — ${body}`
    })
    parts.push(`Active constraints:\n${lines.join("\n")}`)
  }
  return parts.join("\n\n")
}
