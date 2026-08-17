# dsh-fff

FFF (Fast File Finder) tools for DeepSeek Harness. Registers `fffind` (fuzzy file-path search / glob) and `ffgrep` (content grep) as model tools, backed by a resident [`@ff-labs/fff-node`](https://github.com/dmtrKovalenko/fff) index whose root **follows the current session workspace**.

## Install

```sh
dsh plugin --profile <name> add ./dsh-fff
# restart dsh web for the bundle layer to activate
```

This links the bundle into the profile's `node_modules`, appends it to `dsh.profile.bundles`, and inserts the `fff-tools` plugin row. Remove with `dsh plugin --profile <name> remove dsh-fff`.

The bundle declares `@ff-labs/fff-node` as a dependency, so pnpm installs the platform native binary (`@ff-labs/fff-bin-<platform>`) alongside.

## How it works

The native fff SDK cannot load inside the harness process, so the plugin spawns a **resident helper** (`lib/fff-server.mjs`) that owns one `FileFinder` hot index and answers line-delimited JSON on stdio — the same spawn-a-native-binary pattern as `@deepseek-ai/dsh-tool-fs-search`.

Each tool call resolves the calling session's workspace from `exec.agent.session.header.cwd`. When it differs from the helper's current index root, the plugin asks the helper to `reindex` (and waits for the new scan, ~50–100 ms) before querying. This is what the MCP-injected `fff-mcp` could not do: its index root was fixed by the process cwd's git-root probe, so it searched the wrong tree for every session in another workspace.

## Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `fffind` | Fuzzy file-path search (or glob) | `query` (req), `pageSize`, `useGlob` |
| `ffgrep` | Content grep (plain/regex/fuzzy) | `query` (req), `mode`, `pageSize`, `beforeContext`, `afterContext`, `classifyDefinitions` |

Both return `{ base, totalMatched, totalFiles, items }`; `output.render` presents the matches as model text.

## Configuration

The `fff-tools` row accepts these keys (all optional):

| Key | Default | Description |
|-----|---------|-------------|
| `basePath` | `''` | Fixed index root; empty resolves from the session workspace per call |
| `scanTimeoutMs` | `30000` | Wait budget for an index scan / reindex |
| `toolCallTimeoutMs` | `30000` | RPC timeout per tool call |
| `serverPath` | packaged copy | Absolute path to the helper script |

## Model Experience

### Request context and condition

#### What the model sees

Two tool schemas (`fffind`, `ffgrep`) with descriptions that direct fuzzy/indexed search over the built-in ripgrep tools.

#### Token effect

Fixed: two tool definitions are always registered while the plugin is loaded; their descriptions are part of the assembled tool catalog.

#### KV Cache effect

The tool-catalog prefix is stable while the plugin is loaded; no per-request dynamic content is injected into the prompt.

## Known Limitations and Deferred Work

- **Concurrent sessions share one index root.** The resident helper holds a single `FileFinder`; when two sessions in different workspaces interleave calls, each call reindexes to its own workspace (correct but pays the reindex cost on each switch). A per-session cache or the `agent/session-start` warm-up is future work.
- **Native binary platform coverage** is whatever `@ff-labs/fff-node` ships; an unsupported platform surfaces a clear tool error.
- **No background file watcher** (`disableWatch: true`): the index reflects the state at last reindex, not live filesystem changes. Reindex happens per workspace switch; within one workspace, files edited after indexing are picked up on the next reindex.
