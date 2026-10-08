/**
 * dsh-codex-parity — host half.
 *
 * One feature: the Git menu. It exposes the git RPCs the header button uses —
 * state, commit, push, branch switch, branch create and init — on DSH's public
 * surfaces only.
 *
 * Deliberate invariants:
 *   1. Never parse or rewrite `session.vN.jsonl.zstd`; the session log is only
 *      read to recover the working directory a session recorded.
 *   2. Git runs as a real subprocess in that directory; nothing is mocked.
 */

import { execFile } from 'node:child_process'
import { basename, resolve } from 'node:path'

export const name = 'dsh-codex-parity'

/**
 * Deliberately empty.
 *
 * Putting `connection` here looks natural but is a trap: it is provided by the
 * web app layer, not by `dsh-base`. In a profile that composes base without the
 * web app the loader reports the plugin as `pending (waiting for service:
 * connection)` and `apply()` is never called — the plugin is silently inert with
 * no error anywhere. Resolving services inside `apply` and wiring the routes the
 * moment `connection` appears keeps the failure visible instead.
 */
export const inject = []

const LOG = '[dsh-codex-parity]'
const VERSION = '0.1.0'
const MAX_ID_LENGTH = 300

//#region shared helpers

/** An id we are willing to look up, never a path segment. */
function assertSafeId(value, field = 'sessionId') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RpcError('invalid-request', `${field} must be a non-empty string`)
  }
  const id = value.trim()
  if (id.length > MAX_ID_LENGTH) throw new RpcError('invalid-request', `${field} is too long`)
  if (id === '.' || id === '..') throw new RpcError('invalid-request', `${field} is not a valid id`)
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new RpcError('invalid-request', `${field} must not contain path separators`)
  }
  return id
}

class RpcError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CodexParityError'
    this.code = code
  }
}

//#endregion

//#region services

/** Resolve a lazily-read host service, or undefined when this deployment lacks it. */
function service(ctx, key) {
  try {
    return ctx.get(key)
  } catch {
    return undefined
  }
}

/**
 * The durable header for a session id, preferring the persistence half.
 * Only `cwd` is read from it.
 */
async function findHeader(ctx, sessionId) {
  const persistence = service(ctx, 'sessionPersistence')
  if (persistence?.list !== undefined) {
    const rows = await persistence.list()
    const hit = rows.find((row) => (row?.id ?? row?.header?.id) === sessionId)
    if (hit !== undefined) return hit?.header ?? hit
  }
  const query = service(ctx, 'sessionQuery')
  if (query?.listSessions !== undefined) {
    const rows = await query.listSessions()
    const hit = rows.find((row) => (row?.header?.id ?? row?.id) === sessionId)
    if (hit !== undefined) return hit?.header ?? hit
  }
  return null
}

//#endregion

//#region git

const GIT_TIMEOUT_MS = 8000
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/

/** Run one git command; never throws, callers read `ok`. */
function gitExec(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? '')
      })
    })
  })
}

async function gitCwd(ctx, sessionId) {
  const header = await findHeader(ctx, sessionId)
  const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? header.cwd : undefined
  if (cwd === undefined) throw new RpcError('unavailable', `session "${sessionId}" records no working directory`)
  return cwd
}

/** The session's working directory, or a coded error when it is not a repo. */
async function requireRepo(ctx, sessionId) {
  const cwd = await gitCwd(ctx, sessionId)
  const probe = await gitExec(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!probe.ok || probe.stdout.trim() !== 'true') throw new RpcError('not-a-repo', `"${cwd}" is not a git work tree`)
  return cwd
}

/**
 * `git status --porcelain=v1 -b` + `git diff --numstat HEAD`, folded into the
 * per-file add/del counts the summary line needs.
 */
function parseStatus(porcelain, numstat) {
  const counts = new Map()
  for (const line of numstat.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    counts.set(parts.slice(2).join('\t'), {
      add: parts[0] === '-' ? 0 : Number(parts[0]) || 0,
      del: parts[1] === '-' ? 0 : Number(parts[1]) || 0
    })
  }
  const stats = []
  for (const line of porcelain.split('\n')) {
    if (line === '') continue
    if (line.startsWith('## ')) continue
    let path = line.slice(3).trim()
    const arrow = path.lastIndexOf(' -> ')
    if (arrow >= 0) path = path.slice(arrow + 4)
    const stat = counts.get(path) ?? { add: 0, del: 0 }
    stats.push(stat)
  }
  return stats
}

/** `gitState` — the summary line and branch list the menu needs. */
async function gitState(ctx, payload) {
  const sessionId = assertSafeId(payload?.sessionId, 'sessionId')
  const cwd = await gitCwd(ctx, sessionId)
  const probe = await gitExec(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!probe.ok || probe.stdout.trim() !== 'true') {
    return {
      isRepo: false,
      state: 'no-repo',
      branch: null,
      detachedSha: '',
      branches: [],
      blockedBranches: [],
      hasRemote: false,
      totals: { n: 0, add: 0, del: 0 }
    }
  }
  const [branchOut, symOut, shaOut, refsOut, statusOut, numstatOut, wtOut, remoteOut] = await Promise.all([
    gitExec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    // `rev-parse` cannot name a branch that has no commit yet, but the symbolic
    // ref still can: a fresh `git init` knows it is on `master`/`main` already.
    gitExec(cwd, ['symbolic-ref', '--short', 'HEAD']),
    gitExec(cwd, ['rev-parse', '--short', 'HEAD']),
    gitExec(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    gitExec(cwd, ['status', '--porcelain=v1', '-b']),
    gitExec(cwd, ['diff', '--numstat', 'HEAD']),
    gitExec(cwd, ['worktree', 'list', '--porcelain']),
    // Whether any remote is configured at all; the client greys out 推送 without one.
    gitExec(cwd, ['remote'])
  ])
  const worktrees = parseWorktrees(wtOut.stdout)
  const status = parseStatus(statusOut.stdout, numstatOut.stdout)
  // `rev-parse` fails on a branch with no commit yet (a fresh `git init`), so fall
  // back to the symbolic ref, which still knows which branch HEAD points at.
  const unbornBranch = !branchOut.ok && symOut.ok ? symOut.stdout.trim() : ''
  const headRef = branchOut.ok ? branchOut.stdout.trim() : (unbornBranch === '' ? 'HEAD' : unbornBranch)
  const sha = shaOut.ok ? shaOut.stdout.trim() : ''
  const detached = headRef === 'HEAD'
  // Worktrees other than this checkout; their branches cannot be switched to here.
  // Compare against the repository top level: `cwd` may be a subdirectory while
  // `git worktree list` always reports the checkout root.
  const root = (await gitExec(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim() || cwd
  const elsewhere = worktrees.filter((item) => item.branch !== null && resolve(item.path) !== resolve(root))
  const branches = []
  for (const name of refsOut.stdout.split('\n')) {
    const trimmed = name.trim()
    if (trimmed === '') continue
    const holder = elsewhere.find((item) => item.branch === trimmed)
    branches.push({
      name: trimmed,
      current: trimmed === headRef,
      note: holder === undefined ? undefined : `已检出在 ${basename(holder.path)}`
    })
  }
  // A branch with no commits has no ref for `for-each-ref` to list, so the
  // symbolic ref above is the only evidence it exists; show it as the current one.
  if (unbornBranch !== '') branches.push({ name: unbornBranch, current: true, note: '还没有提交' })
  const totals = status.reduce((acc, file) => ({ n: acc.n + 1, add: acc.add + file.add, del: acc.del + file.del }), { n: 0, add: 0, del: 0 })
  return {
    isRepo: true,
    state: detached ? 'detached' : 'branch',
    branch: detached ? null : headRef,
    mainBranch: worktrees.length > 0 && worktrees[0].branch !== null ? worktrees[0].branch : headRef,
    detachedSha: sha,
    branches,
    blockedBranches: elsewhere.map((item) => ({ branch: item.branch, path: item.path })),
    hasRemote: remoteOut.ok && remoteOut.stdout.trim() !== '',
    totals
  }
}

/** The worktree list, reduced to the checkout path and branch it holds. */
function parseWorktrees(text) {
  const rows = []
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line === '') {
      if (current !== null) rows.push(current)
      current = null
      continue
    }
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), branch: null }
      continue
    }
    if (current === null) continue
    if (line.startsWith('branch refs/heads/')) current.branch = line.slice(18)
  }
  if (current !== null) rows.push(current)
  return rows
}

/** `gitInit` — turn a plain project directory into a Git repository. */
async function gitInit(ctx, payload) {
  const sessionId = assertSafeId(payload?.sessionId, 'sessionId')
  const cwd = await gitCwd(ctx, sessionId)
  const probe = await gitExec(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (probe.ok && probe.stdout.trim() === 'true') {
    throw new RpcError('already-repo', '该目录已经是 Git 仓库')
  }
  const out = await gitExec(cwd, ['init'])
  if (!out.ok) throw new RpcError('git-failed', out.stderr.trim() || 'git init failed')
  return gitState(ctx, { sessionId })
}

function assertBranchName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!BRANCH_NAME_PATTERN.test(name) || name.includes('..') || name.endsWith('.lock')) {
    throw new RpcError('invalid-request', 'invalid branch name')
  }
  return name
}

async function gitBranchSwitch(ctx, payload) {
  const sessionId = assertSafeId(payload?.sessionId, 'sessionId')
  const branch = assertBranchName(payload?.branch)
  const cwd = await requireRepo(ctx, sessionId)
  const wt = await gitExec(cwd, ['worktree', 'list', '--porcelain'])
  const holder = parseWorktrees(wt.stdout).find((item) => item.branch === branch && resolve(item.path) !== resolve(cwd))
  if (holder !== undefined) throw new RpcError('branch-in-use', `分支已在 ${holder.path} 检出`)
  const out = await gitExec(cwd, ['checkout', branch])
  if (!out.ok) throw new RpcError('git-failed', out.stderr.trim() || `checkout ${branch} failed`)
  return gitState(ctx, { sessionId })
}

async function gitBranchCreate(ctx, payload) {
  const sessionId = assertSafeId(payload?.sessionId, 'sessionId')
  const name = assertBranchName(payload?.name)
  const base = assertBranchName(payload?.base)
  const cwd = await requireRepo(ctx, sessionId)
  // A repo with no commits yet has no ref for `<base>` to resolve, but creating a
  // branch off the unborn HEAD works when no base is named.
  const head = await gitExec(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  const out = await gitExec(cwd, head.ok ? ['switch', '-c', name, base] : ['switch', '-c', name])
  if (!out.ok) throw new RpcError('git-failed', out.stderr.trim() || `create ${name} failed`)
  return gitState(ctx, { sessionId })
}

/** `gitCommit` — stage everything, then commit with a required message. */
async function gitCommit(ctx, payload) {
  const sessionId = assertSafeId(payload?.sessionId, 'sessionId')
  const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
  if (message === '') throw new RpcError('invalid-request', 'message must contain non-whitespace content')
  const cwd = await requireRepo(ctx, sessionId)
  const add = await gitExec(cwd, ['add', '-A'])
  if (!add.ok) throw new RpcError('git-failed', add.stderr.trim() || 'git add -A failed')
  const commit = await gitExec(cwd, ['commit', '-m', message])
  if (!commit.ok) throw new RpcError('git-failed', commit.stderr.trim() || 'git commit failed')
  return gitState(ctx, { sessionId })
}

/** `gitPush` — push the current branch; refuses to guess an upstream. */
async function gitPush(ctx, payload) {
  const sessionId = assertSafeId(payload?.sessionId, 'sessionId')
  const cwd = await requireRepo(ctx, sessionId)
  const upstream = await gitExec(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!upstream.ok) {
    throw new RpcError('no-upstream', '当前分支没有 upstream；请先手动执行 git push -u <remote> <branch>')
  }
  const out = await gitExec(cwd, ['push'])
  if (!out.ok) throw new RpcError('git-failed', out.stderr.trim() || 'git push failed')
  return { pushed: true }
}

//#endregion

export function apply(ctx) {
  const handlers = new Map([
    ['ping', ping],
    ['gitState', gitState],
    ['gitBranchSwitch', gitBranchSwitch],
    ['gitBranchCreate', gitBranchCreate],
    ['gitCommit', gitCommit],
    ['gitPush', gitPush],
    ['gitInit', gitInit]
  ])

  const methods = [...handlers.keys()]

  const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } })

  const invoke = async (method, payload) => {
    const handler = handlers.get(method)
    if (handler === undefined) {
      return failure('unknown-method', `unknown method: ${method}`)
    }
    try {
      return { ok: true, value: await handler(ctx, payload) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof RpcError ? error.code : 'internal'
      if (code === 'internal') console.warn(`${LOG} ${method} failed: ${message}`)
      return failure(code, message)
    }
  }

  /**
   * Register the routes on a connection that has appeared.
   *
   * DSH 0.2 exposes one shared `/api` interceptor already owned by Remote, so
   * exact Fetch routes compose with it and keep Connection's auth/trust fence.
   * DSH 0.1 has no `fetch`, and falls back to its dedicated logical channel.
   */
  function wire(connection) {
    if (connection === undefined || connection === null) return undefined
    if (connection.fetch?.register === undefined && connection.rpc?.handle === undefined) return undefined

    if (connection.fetch?.register === undefined) {
      const dispose = connection.rpc.handle('/codex-parity', async (method, payload) => {
        const result = await invoke(method, payload)
        return result.ok ? result.value : { __error: result.error }
      })
      return async () => {
        await dispose()
      }
    }

    const disposers = methods.map((method) => connection.fetch.register({
      path: `/api/${method}`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        let envelope
        try {
          envelope = await request.json()
        } catch {
          return new Response('body is not JSON', { status: 400 })
        }
        if (envelope?.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== method) {
          return new Response('invalid client-request', { status: 400 })
        }
        const result = await invoke(method, envelope.payload)
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
      }
    }))
    return async () => {
      await Promise.all(disposers.map((fn) => fn()))
    }
  }

  let releaseRoutes = null
  let reported = false

  const ensureRoutes = () => {
    if (releaseRoutes !== null) return
    const connection = service(ctx, 'connection')
    const release = wire(connection)
    if (release === undefined) {
      if (!reported) {
        reported = true
        console.warn(`${LOG} waiting for the connection service; routes are not registered yet`)
      }
      return
    }
    releaseRoutes = release
    reported = false
    console.log(`${LOG} host ready (v${VERSION}) with ${methods.length} methods: ${methods.join(', ')}`)
  }

  // A service can appear after this plugin loads (the desktop/web shell brings up
  // `connection` later), so react to injection instead of only sampling once.
  ctx.inject?.(['connection'], () => {
    ensureRoutes()
  })
  ensureRoutes()

  ctx.effect(() => () => {
    const release = releaseRoutes
    releaseRoutes = null
    if (release === null) return undefined
    return Promise.resolve(release()).catch((error) => {
      console.warn(`${LOG} route dispose failed: ${String(error)}`)
    })
  }, 'dsh-codex-parity: connection routes')

  if (releaseRoutes === null) {
    console.log(`${LOG} loaded; waiting for the connection service before serving RPC`)
  }
}

/** `ping` — the client probes this to learn the host is alive. */
function ping() {
  return { ok: true, version: VERSION }
}

export const __test = {
  assertSafeId,
  parseWorktrees,
  parseStatus,
  gitState,
  VERSION
}
