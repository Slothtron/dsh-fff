#!/usr/bin/env node
/**
 * fff-server — resident FFF index process for the @slothtron/dsh-fff plugin.
 *
 * Owns one @ff-labs/fff-node FileFinder so the native path + content index
 * stays warm in a single long-lived process. Reads JSON requests on stdin,
 * writes JSON responses on stdout (one per line). The parent @slothtron/dsh-fff
 * plugin spawns this process and proxies model-visible tool calls to it.
 *
 * Protocol:
 *   request:  { id, method, args }
 *   response: { id, ok: true, value } | { id, ok: false, error }
 *
 * Methods:
 *   fileSearch(query, options) -> { base, totalMatched, totalFiles, items }
 *   glob(pattern, options)     -> { base, totalMatched, totalFiles, items }
 *   grep(query, options)       -> { base, totalMatched, totalFiles, items }
 *   multiGrep(options)         -> { base, totalMatched, totalFiles, items }
 *   reindex(newPath)           -> { base }
 *   health()                   -> { base, scanning, scannedFiles, ... }
 *
 * The process exits on EOF of stdin (parent closed the pipe or shutdown).
 */
import { FileFinder } from '@ff-labs/fff-node'

const args = process.argv.slice(2)

function argValue(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

// --base <dir>  : initial directory to index (default: workspace root / cwd)
// --timeout <n> : milliseconds to wait for the initial scan (default: 30000)
// --watch       : enable the background file watcher on the initial index
const initialBase = argValue('--base', process.env.DSH_WORKSPACE_ROOT || process.cwd())
const scanTimeoutMs = Number(argValue('--timeout', '30000'))

let finder = null
let baseRoot = initialBase
// Watcher state, toggled live through the `reconfigure` RPC: a settings-card
// switch destroys the current index and rebuilds it with the new watch mode.
let disableWatch = !args.includes('--watch')

function ensureFinder() {
  if (finder !== null && !finder.isDestroyed) return finder
  const init = FileFinder.create({
    basePath: baseRoot,
    aiMode: true,
    disableWatch,
  })
  if (!init.ok) {
    throw new Error(`FileFinder.create failed: ${init.error}`)
  }
  finder = init.value
  return finder
}

/** Compact file items to the leaf fields the model needs. */
function compactFileItems(items, scores) {
  return items.slice(0, 200).map((it, i) => ({
    path: it.relativePath,
    name: it.fileName,
    gitStatus: it.gitStatus,
    score: scores && scores[i] ? Math.round(scores[i].total) : undefined,
  }))
}

/** Compact grep matches to the leaf fields the model needs. */
function compactGrep(items) {
  return items.slice(0, 200).map((m) => ({
    path: m.relativePath,
    line: m.lineNumber,
    col: m.col,
    text: m.lineContent,
    isDefinition: m.isDefinition,
    contextBefore: m.contextBefore && m.contextBefore.length ? m.contextBefore : undefined,
    contextAfter: m.contextAfter && m.contextAfter.length ? m.contextAfter : undefined,
  }))
}

const handlers = {
  async fileSearch(args) {
    const f = await readyFinder(Number(args.scanTimeoutMs || 30000))
    const res = f.fileSearch(String(args.query || ''), {
      pageSize: Number(args.pageSize || 50),
    })
    if (!res.ok) return { ok: false, error: res.error }
    return {
      ok: true,
      value: {
        base: baseRoot,
        totalMatched: res.value.totalMatched,
        totalFiles: res.value.totalFiles,
        items: compactFileItems(res.value.items, res.value.scores),
      },
    }
  },

  async glob(args) {
    const f = await readyFinder(Number(args.scanTimeoutMs || 30000))
    const res = f.glob(String(args.pattern || ''), {
      pageSize: Number(args.pageSize || 100),
    })
    if (!res.ok) return { ok: false, error: res.error }
    return {
      ok: true,
      value: {
        base: baseRoot,
        totalMatched: res.value.totalMatched,
        totalFiles: res.value.totalFiles,
        items: compactFileItems(res.value.items, res.value.scores),
      },
    }
  },

  async grep(args) {
    const f = await readyFinder(Number(args.scanTimeoutMs || 30000))
    const res = f.grep(String(args.query || ''), {
      mode: args.mode === 'regex' || args.mode === 'fuzzy' ? args.mode : 'plain',
      smartCase: args.smartCase !== false,
      pageSize: Number(args.pageSize || 50),
      beforeContext: Number(args.beforeContext || 0),
      afterContext: Number(args.afterContext || 0),
      classifyDefinitions: args.classifyDefinitions === true,
      maxMatchesPerFile: Number(args.maxMatchesPerFile || 50),
    })
    if (!res.ok) return { ok: false, error: res.error }
    const v = res.value
    return {
      ok: true,
      value: {
        base: baseRoot,
        totalMatched: v.totalMatched,
        totalFiles: v.totalFiles,
        totalFilesSearched: v.totalFilesSearched,
        filteredFileCount: v.filteredFileCount,
        regexFallbackError: v.regexFallbackError,
        items: compactGrep(v.items),
      },
    }
  },

  async multiGrep(args) {
    const f = await readyFinder(Number(args.scanTimeoutMs || 30000))
    const res = f.multiGrep({
      patterns: Array.isArray(args.patterns) ? args.patterns.map(String) : [],
      smartCase: args.smartCase !== false,
      pageSize: Number(args.pageSize || 50),
      beforeContext: Number(args.beforeContext || 0),
      afterContext: Number(args.afterContext || 0),
      classifyDefinitions: args.classifyDefinitions === true,
    })
    if (!res.ok) return { ok: false, error: res.error }
    const v = res.value
    return {
      ok: true,
      value: {
        base: baseRoot,
        totalMatched: v.totalMatched,
        totalFiles: v.totalFiles,
        items: compactGrep(v.items),
      },
    }
  },

  async reindex(args) {
    const newPath = String(args.path || '')
    if (newPath.length === 0) return { ok: false, error: 'reindex requires a path' }
    const f = ensureFinder()
    const res = f.reindex(newPath)
    if (!res.ok) return { ok: false, error: res.error }
    baseRoot = newPath
    // Wait for the new index scan to complete so the caller can query immediately.
    await readyFinder(Number(args.scanTimeoutMs || 30000))
    return { ok: true, value: { base: baseRoot } }
  },

  async waitForIndexReady(args) {
    const f = ensureFinder()
    const done = await f.waitForIndexReady(Number(args.timeoutMs || 30000))
    return { ok: done.ok, value: done.value, ...(done.ok ? {} : { error: done.error }) }
  },

  async reconfigure(args) {
    const nextDisableWatch = args.disableWatch === true
    if (nextDisableWatch === disableWatch && finder !== null && !finder.isDestroyed) {
      return { ok: true, value: { disableWatch, base: baseRoot } }
    }
    disableWatch = nextDisableWatch
    // A watch-mode change cannot apply to a live index: destroy it and rebuild
    // with the new flag. The next search re-creates the finder lazily.
    if (finder !== null && !finder.isDestroyed) {
      try {
        finder.destroy()
      } catch {
        /* already gone */
      }
    }
    finder = null
    return { ok: true, value: { disableWatch, base: baseRoot } }
  },

  health() {
    let progress = null
    let health = null
    try {
      const f = ensureFinder()
      const p = f.getScanProgress()
      progress = p.ok ? p.value : null
      const h = f.healthCheck()
      health = h.ok ? h.value : null
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) }
    }
    return {
      ok: true,
      value: {
        base: baseRoot,
        scanning: progress ? progress.isScanning : 'unknown',
        scannedFiles: progress ? progress.scannedFilesCount : 'unknown',
        warmupComplete: progress ? progress.isWarmupComplete : 'unknown',
        git: health ? health.git : null,
      },
    }
  },
}

/** Ensure the finder exists AND its initial scan has completed (so queries return real data). */
async function readyFinder(timeoutMs) {
  const f = ensureFinder()
  // Use the SDK's official native-backed wait, which is reliable inside the
  // helper process (a hand-rolled setTimeout poll can starve under the ffi
  // scan thread).
  const done = await f.waitForScan(timeoutMs)
  if (!done.ok || !done.value) throw new Error(done.error || `index scan did not complete in ${timeoutMs}ms`)
  // Warmup (content/bigram) completes right after the scan; wait for it so
  // grep uses the content index for speed. Best-effort: a timeout here is not
  // fatal, queries still work against mmap.
  await f.waitForIndexReady(timeoutMs).catch(() => {})
  return f
}

function respond(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

// Bootstrapping: create the finder eagerly so the first tool call is fast.
try {
  ensureFinder()
} catch (err) {
  process.stderr.write(`fff-server: initial FileFinder.create failed: ${String(err && err.message || err)}\n`)
  // keep serving; searches will attempt creation again and surface the error
}

let buffer = ''
let queue = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    let req
    try {
      req = JSON.parse(line)
    } catch {
      respond({ id: null, ok: false, error: 'invalid JSON request' })
      continue
    }
    const handler = handlers[req.method]
    if (!handler) {
      respond({ id: req.id, ok: false, error: `unknown method: ${req.method}` })
      continue
    }
    // Serialize requests: the fff native library is safest with one call at a
    // time, and tool calls arrive one per model step anyway.
    queue = queue.then(async () => {
      try {
        const result = await handler(req.args || {})
        respond({ id: req.id, ...result })
      } catch (err) {
        respond({ id: req.id, ok: false, error: String(err && err.message || err) })
      }
    })
  }
})
process.stdin.on('end', () => {
  try {
    if (finder !== null) finder.destroy()
  } catch {
    /* already gone */
  }
  process.exit(0)
})
