/**
 * finder — resident fff helper process manager for the @slothtron/dsh-fff plugin.
 *
 * Spawns one `fff-server.mjs` child process that owns the @ff-labs/fff-node
 * FileFinder hot index, and proxies model tool calls to it over line-delimited
 * JSON on stdio. The helper follows the session workspace: when the requested
 * base directory differs from the helper's current index root, it reindexes
 * (and waits for the new scan) before querying.
 *
 * Lifecycle is effect-scoped: the plugin's dispose path terminates the helper.
 * A helper crash is restarted once (with a fresh index); a second failure
 * surfaces a clear error to the caller.
 */

/**
 * Manage one resident fff helper child process.
 *
 * Methods:
 * - `ensureServer()` — lazily spawn the helper (first call), returning the live handle.
 * - `ensureBase(base)` — make the helper index `base` (reindex when it differs), then ready.
 * - `search(method, base, args)` — one search RPC, ensuring the helper is indexed at `base`.
 * - `dispose()` — terminate the helper.
 */
export class FffFinder {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.handle = null
    this.starting = null
    this.currentBase = null
    this.buffer = ''
    this.seq = 0
    this.pending = new Map()
    this.disposed = false
  }

  /** Whether the helper is currently running. */
  get alive() {
    return this.handle !== null && !this.disposed
  }

  /** The index root the helper currently holds (null when not spawned). */
  get base() {
    return this.currentBase
  }

  /** Lazily spawn the helper process. Concurrent first calls share one spawn. */
  async ensureServer() {
    if (this.handle !== null) return this.handle
    if (this.starting !== null) return this.starting
    this.starting = this.spawn().catch((err) => {
      this.starting = null
      this.handle = null
      throw err
    })
    return this.starting
  }

  async spawn() {
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) {
      throw new Error('dsh-fff: the subprocess service is not mounted')
    }
    const nodeBin = await subprocess.resolveExecutable('node')
    const spec = {
      argv: [nodeBin, this.config.serverPath, '--timeout', String(this.config.scanTimeoutMs)],
      cwd: process.cwd(),
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: 8192 },
      },
      graceMs: 2000,
    }
    const handle = subprocess.spawn(spec)
    this.handle = handle
    this.wireOutput(handle)
    // The helper exits when the parent stops it or crashes.
    handle.done.then(() => {
      this.handle = null
      this.currentBase = null
      for (const [, req] of this.pending) {
        req.resolve({ ok: false, error: 'fff-server exited' })
        req.timer()
      }
      this.pending.clear()
    }).catch(() => {
      this.handle = null
    })
    return handle
  }

  wireOutput(handle) {
    this.buffer = ''
    if (handle.stdout === undefined) return
    handle.stdout.on('data', (chunk) => {
      this.buffer += chunk
      let nl
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl)
        this.buffer = this.buffer.slice(nl + 1)
        if (!line.trim()) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        const req = this.pending.get(msg.id)
        if (req !== undefined) {
          this.pending.delete(msg.id)
          req.timer()
          req.resolve({
            ok: msg.ok === true,
            ...(msg.ok === true ? { value: msg.value } : { error: msg.error }),
          })
        }
      }
    })
  }

  call(method, args) {
    return new Promise((resolve) => {
      const current = this.handle
      if (current === null || current.stdin === undefined) {
        resolve({ ok: false, error: 'fff-server is not running' })
        return
      }
      const id = ++this.seq
      const timer = this.ctx.timeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          resolve({ ok: false, error: `fff-server: timed out on ${method}` })
        }
      }, this.config.rpcTimeoutMs)
      this.pending.set(id, { resolve, timer })
      current.stdin.write(`${JSON.stringify({ id, method, args })}\n`)
    })
  }

  /** Ensure the helper is indexed at `base`, reindexing when it differs from the current root. */
  async ensureBase(base) {
    if (this.disposed) throw new Error('dsh-fff: finder is disposed')
    await this.ensureServer()
    if (this.currentBase === base) return
    // Fresh spawn indexes its process cwd (the harness cwd), which may differ
    // from the session workspace. On first spawn, probe health to adopt the
    // actual base; if it already matches, we are done.
    if (this.currentBase === null) {
      const probe = await this.call('health', {})
      if (probe.ok && probe.value && typeof probe.value === 'object') {
        const b = probe.value.base
        if (b === base) {
          this.currentBase = base
          return
        }
      }
    }
    const res = await this.call('reindex', {
      path: base,
      scanTimeoutMs: this.config.scanTimeoutMs,
    })
    if (!res.ok) throw new Error(`dsh-fff: reindex to ${base} failed: ${res.error}`)
    this.currentBase = base
  }

  /** One search RPC, ensuring the helper is indexed at `base` first. */
  async search(method, base, args) {
    await this.ensureBase(base)
    return this.call(method, { ...args, scanTimeoutMs: this.config.scanTimeoutMs })
  }

  /** Terminate the helper process. Idempotent. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.handle !== null) {
      const h = this.handle
      this.handle = null
      try {
        if (h.stdin !== undefined) h.stdin.end()
      } catch {
        /* already closed */
      }
    }
    for (const [, req] of this.pending) req.resolve({ ok: false, error: 'dsh-fff: finder disposed' })
    this.pending.clear()
  }
}
