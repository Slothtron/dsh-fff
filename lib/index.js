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
 * Plain-JS ESM bundle plugin: no build step, no import of dsh packages. Tools
 * register through `ctx.tools.register` with plain JSON-schema parameters and
 * output (the registry's `schemaOf` projects them directly), so the only
 * runtime dependency is `@ff-labs/fff-node` (via the helper) plus the services
 * `tools` and `subprocess` that the harness provides on `ctx`.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FffFinder } from './finder.js'

export const name = 'dsh-fff'

export const inject = ['tools', 'subprocess', 'timer']

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

export function apply(ctx, config) {
  const cfg = {
    basePath: config?.basePath ?? '',
    scanTimeoutMs: config?.scanTimeoutMs ?? 30000,
    toolCallTimeoutMs: config?.toolCallTimeoutMs ?? 30000,
    serverPath: config?.serverPath ?? '',
  }
  const finder = new FffFinder(ctx, {
    serverPath: resolveServerPath(cfg),
    scanTimeoutMs: cfg.scanTimeoutMs,
    rpcTimeoutMs: cfg.toolCallTimeoutMs,
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
      render(_args, value) {
        const lines = [`fff find in ${value.base} — ${value.totalMatched} match(es)`]
        for (const it of value.items) {
          const mark = it.gitStatus === 'clean' ? ' ' : '*'
          lines.push(`  ${mark}[${it.gitStatus}] ${it.path}${it.score ? ` (${it.score})` : ''}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
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
      render(_args, value) {
        const lines = [`fff grep in ${value.base} — ${value.totalMatched} match(es)`]
        for (const it of value.items) {
          const def = it.isDefinition ? ' (def)' : ''
          lines.push(`  ${it.path}:${it.line}:${it.text}${def}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
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
