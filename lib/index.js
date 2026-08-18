/**
 * @slothtron/dsh-fff — fff (Fast File Finder) tools for DeepSeek Harness.
 *
 * Registers `fffind` (fuzzy file-path search / glob) and `ffgrep` (content
 * grep) model tools backed by a resident @ff-labs/fff-node index. The index
 * root follows the calling session's workspace: each call resolves the current
 * session cwd from `exec.agent.session.header.cwd` and, when it differs from
 * the helper's current index root, reindexes before querying.
 *
 * The native fff SDK (`@ff-labs/fff-node`) cannot load inside the harness
 * process, so the plugin spawns a resident helper (`fff-server.mjs`) that owns
 * the FileFinder hot index and answers line-delimited JSON on stdio — the same
 * spawn-a-native-binary pattern as `@deepseek-ai/dsh-tool-fs-search`.
 *
 * Plain-JS ESM bundle plugin for the Host half: no build step. Tools register
 * through `ctx.tools.register` with plain JSON-schema parameters and output
 * (the registry's `schemaOf` projects them directly). The only runtime
 * dependencies are `@ff-labs/fff-node` (via the helper) and `@deepseek-ai/schemastery`
 * (the settings schema), plus the services `tools`, `subprocess`, and `timer`
 * that the harness provides on `ctx`. The watch switch is exposed as a runtime
 * settings namespace the browser half edits.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { FffFinder } from './finder.js'

export const name = 'dsh-fff'

export const inject = ['tools', 'subprocess', 'timer']

/** Settings namespace the web card edits; kebab-case per the settings brand. */
const SETTINGS_NS = 'dsh-fff'

/** Settings schema: the watch switch is the only runtime-tunable knob. */
const SettingsConfig = z.object({
  enableWatch: z.boolean().default(false),
})

/** Resolve the helper script path: explicit config, else the packaged lib copy. */
function resolveServerPath(config) {
  if (config.serverPath && config.serverPath.length > 0) return config.serverPath
  // This module lives at lib/index.js; the helper ships beside it at
  // lib/fff-server.mjs.
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, 'fff-server.mjs')
}

/** The session workspace cwd for a tool call, or the configured base / cwd fallback. */
function sessionCwd(exec, basePath) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (cwd !== undefined && cwd.length > 0) return cwd
  if (basePath.length > 0) return basePath
  return process.cwd()
}

/** Shared output schema for search results (object root, all fields declared). */
const searchOutput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    base: { type: 'string' },
    totalMatched: { type: 'number' },
    totalFiles: { type: 'number' },
    items: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
}

/** Item fields for fffind (file search) results. */
const fileItem = {
  path: { type: 'string' },
  name: { type: 'string' },
  gitStatus: { type: 'string' },
  score: { type: 'number' },
}

/** Item fields for ffgrep (content grep) results. */
const grepItem = {
  path: { type: 'string' },
  line: { type: 'number' },
  col: { type: 'number' },
  text: { type: 'string' },
  isDefinition: { type: 'boolean' },
  contextBefore: { type: 'array', items: { type: 'string' } },
  contextAfter: { type: 'array', items: { type: 'string' } },
}

// ---------------------------------------------------------------------------
// UI presentation (search cards)
//
// The dsh tool render-intent system (docs/cookbook/adding-a-tool.md): a tool
// declares `presentCall` (pending card), `presentationMeta` (durable JSON
// projected from the canonical value), and `presentResult` (completed card).
// Without these the UI falls back to a generic card with raw JSON args — the
// "native text" output. We project the search result into the official
// `card: 'search'` view: `shape: 'paths'` for fffind, `shape: 'matches'` for
// ffgrep. The meta is bounded to keep it replayable in the session log.
// ---------------------------------------------------------------------------

/** Serialized UTF-8 bytes of a JSON payload (the size persisted to the log). */
function metaBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/** Hard cap for serialized presentationMeta; trailing items drop past it. */
const MAX_META_BYTES = 32 * 1024

/**
 * Group retained grep matches by file (first-seen order) into the search-card
 * `matches` shape, bounded to `maxBytes`.
 */
function grepSearchMeta(value, maxBytes) {
  const byFile = new Map()
  for (const it of value.items) {
    let group = byFile.get(it.path)
    if (group === undefined) { group = []; byFile.set(it.path, group) }
    group.push({ lineNumber: it.line, line: it.text })
  }
  let files = Array.from(byFile, ([path, matches]) => ({ path, matches }))
  let truncated = value.totalMatched > value.items.length
  const base = { shape: 'matches', files, truncated, total: value.totalMatched }
  if (metaBytes(base) <= maxBytes) return base
  while (files.length > 1 && metaBytes({ shape: 'matches', files, truncated: true, total: value.totalMatched }) > maxBytes) files.pop()
  return { shape: 'matches', files, truncated: true, total: value.totalMatched }
}

/** Project retained fffind paths into the search-card `paths` shape, bounded. */
function findSearchMeta(value, maxBytes) {
  const paths = value.items.map((it) => it.path)
  const truncated = value.totalMatched > paths.length
  const base = { shape: 'paths', paths, truncated, total: value.totalMatched }
  if (metaBytes(base) <= maxBytes) return base
  const capped = [...paths]
  while (capped.length > 1 && metaBytes({ shape: 'paths', paths: capped, truncated: true, total: value.totalMatched }) > maxBytes) capped.pop()
  return { shape: 'paths', paths: capped, truncated: true, total: value.totalMatched }
}

/** Narrow opaque `meta` (live or replayed) to a `card: 'search'` view, or undefined. */
function searchViewFromMeta(meta) {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { truncated, total } = meta
  if (typeof truncated !== 'boolean' || typeof total !== 'number') return undefined
  if (meta.shape === 'paths') {
    if (!Array.isArray(meta.paths) || !meta.paths.every((p) => typeof p === 'string')) return undefined
    return { card: 'search', shape: 'paths', paths: meta.paths, truncated, total }
  }
  if (meta.shape === 'matches') {
    if (!Array.isArray(meta.files)) return undefined
    const files = []
    for (const f of meta.files) {
      if (typeof f !== 'object' || f === null || typeof f.path !== 'string' || !Array.isArray(f.matches)) return undefined
      const matches = []
      for (const m of f.matches) {
        if (typeof m !== 'object' || m === null || typeof m.lineNumber !== 'number' || typeof m.line !== 'string') return undefined
        matches.push({ lineNumber: m.lineNumber, line: m.line })
      }
      files.push({ path: f.path, matches })
    }
    return { card: 'search', shape: 'matches', files, truncated, total }
  }
  return undefined
}

export function apply(ctx, config) {
  const cfg = {
    basePath: config?.basePath ?? '',
    scanTimeoutMs: config?.scanTimeoutMs ?? 30000,
    toolCallTimeoutMs: config?.toolCallTimeoutMs ?? 30000,
    serverPath: config?.serverPath ?? '',
    enableWatch: config?.enableWatch === true,
  }
  const finder = new FffFinder(ctx, {
    serverPath: resolveServerPath(cfg),
    scanTimeoutMs: cfg.scanTimeoutMs,
    rpcTimeoutMs: cfg.toolCallTimeoutMs,
    enableWatch: cfg.enableWatch,
  })

  // Runtime settings: the web settings card flips `enableWatch` live. The
  // settings service is optional and can arrive after apply() (a different
  // bundle provides it), so register through ctx.inject — a one-shot ctx.get
  // would silently drop the namespace on hosts that ship the service late.
  // A change rebuilds the helper index with the new watch mode.
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(SETTINGS_NS, SettingsConfig, {
      base: { enableWatch: cfg.enableWatch },
      applies: 'live',
    })
    scope.watch((next) => {
      if (next.enableWatch === cfg.enableWatch) return
      cfg.enableWatch = next.enableWatch
      void finder.reconfigure(next.enableWatch).catch((err) => {
        ctx.logger.warn('dsh-fff: reconfigure failed: %s', err instanceof Error ? err.message : String(err))
      })
    })
  })

  const fffind = {
    name: 'fffind',
    description:
      'Fast fuzzy search for file paths in the current session workspace. '
      + 'Use instead of the built-in glob/grep for finding files by name or path. '
      + 'Supports fuzzy matching and special query syntax: "foo bar" (all terms), '
      + '"src/" (directory), "file.ts:42" (file with line). Set useGlob to treat the '
      + 'query as a glob pattern instead. The index root follows the session workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Fuzzy file path query, e.g. "guard" or "src/component" or "*.ts"' },
        pageSize: { type: 'number', description: 'Max results (default 50)', default: 50 },
        useGlob: { type: 'boolean', description: 'Treat query as a glob pattern instead of fuzzy (default false)', default: false },
      },
      required: ['query'],
    },
    output: {
      schema: {
        ...searchOutput,
        properties: {
          ...searchOutput.properties,
          items: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, properties: fileItem },
          },
        },
      },
      presentationMeta: (_args, value) => findSearchMeta(value, MAX_META_BYTES),
      render(_args, value) {
        const lines = [`fff find in ${value.base} — ${value.totalMatched} match(es)`]
        for (const it of value.items) {
          const mark = it.gitStatus === 'clean' ? ' ' : '*'
          lines.push(`  ${mark}[${it.gitStatus}] ${it.path}${it.score ? ` (${it.score})` : ''}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall(args) {
      const mode = args.useGlob ? 'glob' : 'find'
      return { card: 'generic', title: `fff ${mode} ${String(args.query)}`, kind: 'search', rawInput: String(args.query) }
    },
    presentResult(_args, result) {
      if (result.isError) return undefined
      const view = searchViewFromMeta(result.meta)
      if (view === undefined || view.shape !== 'paths') return undefined
      return view
    },
    async execute(args, exec) {
      const base = sessionCwd(exec, cfg.basePath)
      const res = args.useGlob
        ? await finder.search('glob', base, { pattern: args.query, pageSize: args.pageSize })
        : await finder.search('fileSearch', base, { query: args.query, pageSize: args.pageSize })
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
  }

  const ffgrep = {
    name: 'ffgrep',
    description:
      'Fast content search (live grep) across the current session workspace. '
      + 'Use instead of the built-in grep for finding text in file contents. '
      + 'Modes: plain (literal), regex, fuzzy. Returns file:line with content, '
      + 'context lines, and definition classification. The index root follows the session workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Text to search for, e.g. "defineTool" or a regex in regex mode' },
        mode: { type: 'string', enum: ['plain', 'regex', 'fuzzy'], description: 'Search mode (default plain)', default: 'plain' },
        pageSize: { type: 'number', description: 'Max results (default 50)', default: 50 },
        beforeContext: { type: 'number', description: 'Context lines before each match', default: 0 },
        afterContext: { type: 'number', description: 'Context lines after each match', default: 0 },
        classifyDefinitions: { type: 'boolean', description: 'Tag lines that look like code definitions', default: false },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          base: { type: 'string' },
          totalMatched: { type: 'number' },
          totalFiles: { type: 'number' },
          totalFilesSearched: { type: 'number' },
          filteredFileCount: { type: 'number' },
          regexFallbackError: { type: 'string' },
          items: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, properties: grepItem },
          },
        },
      },
      presentationMeta: (_args, value) => grepSearchMeta(value, MAX_META_BYTES),
      render(_args, value) {
        const lines = [`fff grep in ${value.base} — ${value.totalMatched} match(es)`]
        for (const it of value.items) {
          const def = it.isDefinition ? ' (def)' : ''
          lines.push(`  ${it.path}:${it.line}:${it.text}${def}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    presentCall(args) {
      return { card: 'generic', title: `fff grep ${String(args.query)}`, kind: 'search', rawInput: String(args.query) }
    },
    presentResult(_args, result) {
      if (result.isError) return undefined
      const view = searchViewFromMeta(result.meta)
      if (view === undefined || view.shape !== 'matches') return undefined
      return view
    },
    async execute(args, exec) {
      const base = sessionCwd(exec, cfg.basePath)
      const res = await finder.search('grep', base, {
        query: args.query,
        mode: args.mode,
        pageSize: args.pageSize,
        beforeContext: args.beforeContext,
        afterContext: args.afterContext,
        classifyDefinitions: args.classifyDefinitions,
      })
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
  }

  const disposers = [
    ctx.tools.register(fffind),
    ctx.tools.register(ffgrep),
  ]

  // Terminate the helper when the plugin stops / updates / is removed.
  ctx.effect(() => {
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already unregistered */
        }
      }
      finder.dispose()
    }
  })
}
