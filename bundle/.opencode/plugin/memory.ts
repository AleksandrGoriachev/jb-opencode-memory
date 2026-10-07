/**
 * opencode plugin: local agent memory.
 *
 * Reuses the shared core in `.opencode/memory/core.mjs` to:
 * - inject a short memory guide + active high-value constraints into the system
 *   prompt every turn (`experimental.chat.system.transform`);
 * - capture raw user/assistant session digests to `.ai_agents/memory/_digest/`
 *   (`event` + `experimental.session.compacting` + `dispose`).
 *
 * Written as `.ts` so opencode's Bun runtime always loads it as ESM, with no
 * `@opencode-ai/plugin` runtime dependency. No database, no index. All hooks are
 * best-effort: they never throw.
 */
import { existsSync } from "node:fs"
import { DigestBuffer, buildSystemSection, loadEntries, resolveMemoryRoot } from "../memory/core.mjs"

const CACHE_TTL_MS = 2000

export default async (input: { worktree?: string; directory?: string }) => {
  if (process.env.MEMORY_PLUGIN_DISABLED) return {}
  const base = input.worktree || input.directory || process.cwd()
  const root = resolveMemoryRoot(base)
  const digest = new DigestBuffer(root, (message: string) => {
    try {
      console.warn(`[llm-memory] ${message}`)
    } catch {
      /* ignore */
    }
  })

  let cache: { at: number; section: string | null } = { at: 0, section: null }

  const memorySection = (): string | null => {
    try {
      if (!existsSync(root)) return null
      const now = Date.now()
      if (now - cache.at > CACHE_TTL_MS) {
        cache = { at: now, section: buildSystemSection(loadEntries(root)) }
      }
      return cache.section
    } catch {
      return null
    }
  }

  return {
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      try {
        const section = memorySection()
        if (section) output.system.push(section)
      } catch {
        /* never throw */
      }
    },

    event: async ({ event }: { event: any }) => {
      try {
        if (!existsSync(root)) return
        switch (event.type) {
          case "message.updated": {
            const info = event.properties.info
            if (info && (info.role === "user" || info.role === "assistant")) {
              digest.recordMessage({
                sessionID: info.sessionID,
                messageID: info.id,
                role: info.role,
                created: info.time && info.time.created,
              })
            }
            return
          }
          case "message.part.updated": {
            const part = event.properties.part
            if (part && part.type === "text" && !part.synthetic && !part.ignored) {
              digest.recordText({
                sessionID: part.sessionID,
                messageID: part.messageID,
                partID: part.id,
                text: part.text,
              })
            }
            return
          }
          case "session.idle":
          case "session.compacted":
            digest.flush(event.properties.sessionID)
            return
          case "session.deleted":
            digest.drop(event.properties.sessionID)
            return
          default:
            return
        }
      } catch {
        /* never throw */
      }
    },

    "experimental.session.compacting": async (input: { sessionID: string }, output: { context: string[] }) => {
      try {
        digest.flush(input.sessionID)
        output.context.push(
          "If this session produced durable decisions, preferences or architecture, save them to `.ai_agents/memory/` (see the `memory` skill) before finishing.",
        )
      } catch {
        /* never throw */
      }
    },

    dispose: async () => {
      try {
        digest.flushAll()
      } catch {
        /* never throw */
      }
    },
  }
}
