/**
 * Host integration test.
 *
 * Drives the host half the way the DSH Cordis host runner does: import the
 * module, build a context exposing the real service names, call `apply()`, then
 * push real HTTP-shaped envelopes through the fetch routes it registered. The
 * Git feature runs against real repositories on disk.
 *
 * Run: node tests/host-integration.test.mjs
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const host = await import('../dist/formal-host.mjs')

let passed = 0
let failed = 0

async function check(label, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  PASS  ${label}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${label}\n        ${error.message}`)
  }
}

//#region harness

/** Build a context shaped like the real host, capturing registered routes. */
function makeCtx({ sessions = [], withConnection = true } = {}) {
  const routes = new Map()
  const effects = []
  const services = {}
  let reinject

  services.sessionQuery = {
    listSessions: async () => sessions.map((row) => ({ header: row }))
  }
  services.sessionPersistence = {
    list: async () => sessions.map((row) => row)
  }

  if (withConnection) {
    services.connection = {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return async () => {
            routes.delete(route.path)
          }
        }
      }
    }
  }

  const ctx = {
    get(name) {
      return services[name]
    },
    effect(fn) {
      effects.push(fn)
    },
    inject(names, callback) {
      callback()
      reinject = callback
      return () => {}
    },
    fireInject() {
      if (reinject !== undefined) reinject()
    },
    provideConnection() {
      services.connection = {
        fetch: {
          register(route) {
            routes.set(route.path, route)
            return async () => {
              routes.delete(route.path)
            }
          }
        }
      }
    }
  }

  return { ctx, routes, effects, services }
}

/** Send one envelope through a registered route, mimicking the client half. */
async function callRoute(routes, method, payload) {
  const route = routes.get(`/api/${method}`)
  if (route === undefined) throw new Error(`no route registered for ${method}`)
  const body = { type: 'client-request', rpcId: 'rpc-test-1', method, payload: payload === undefined ? {} : payload }
  const response = await route.fetch({
    json: async () => body,
    signal: undefined
  })
  const parsed = await response.json()
  return parsed.result
}

//#endregion

/** A synthetic session whose recorded cwd is what the Git handlers use. */
async function makeSession(id, cwd) {
  return { id, title: `标题 ${id}`, cwd, createdAt: 1_700_000_000_000 }
}

const sandbox = await mkdtemp(join(tmpdir(), 'codex-parity-int-'))
try {
  const repo = join(sandbox, 'git-repo')
  const gitSession = await makeSession('session-git-1', repo)
  const harness = makeCtx({ sessions: [gitSession] })
  host.apply(harness.ctx)

  console.log('\n== route registration ==')
  const expectedMethods = [
    'ping',
    'gitState',
    'gitBranchSwitch',
    'gitBranchCreate',
    'gitCommit',
    'gitPush',
    'gitInit'
  ]
  await check('registers only the Git routes under /api', async () => {
    for (const method of expectedMethods) {
      assert.ok(harness.routes.has(`/api/${method}`), `missing route /api/${method}`)
    }
    assert.equal(harness.routes.size, expectedMethods.length, 'no non-Git route should be registered')
  })
  await check('registers a teardown effect that disposes the routes', async () => {
    const disposable = makeCtx({ sessions: [gitSession] })
    host.apply(disposable.ctx)
    assert.equal(disposable.effects.length, 1)
    assert.equal(disposable.routes.size, expectedMethods.length)
    const dispose = disposable.effects[0]()
    await dispose()
    assert.equal(disposable.routes.size, 0)
  })

  console.log('\n== envelope validation ==')
  await check('rejects a non-client-request envelope with 400', async () => {
    const route = harness.routes.get('/api/ping')
    const response = await route.fetch({ json: async () => ({ type: 'other' }), signal: undefined })
    assert.equal(response.status, 400)
  })
  await check('rejects a non-JSON body with 400', async () => {
    const route = harness.routes.get('/api/ping')
    const response = await route.fetch({ json: async () => { throw new Error('bad json') }, signal: undefined })
    assert.equal(response.status, 400)
  })

  console.log('\n== ping ==')
  await check('reports the plugin version', async () => {
    const result = await callRoute(harness.routes, 'ping', {})
    assert.equal(result.ok, true)
    assert.equal(result.value.version, '0.1.0')
  })

  console.log('\n== git feature (real repo) ==')
  await run('git', ['init', '--initial-branch=main', repo])
  await run('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  await run('git', ['-C', repo, 'config', 'user.name', 'Test'])
  await writeFile(join(repo, 'file.txt'), 'hello\n', 'utf8')
  await run('git', ['-C', repo, 'add', '-A'])
  await run('git', ['-C', repo, 'commit', '-m', 'init'])

  await check('reports the branch and a clean work tree', async () => {
    const result = await callRoute(harness.routes, 'gitState', { sessionId: 'session-git-1' })
    assert.equal(result.ok, true, result.ok ? '' : result.error.message)
    assert.equal(result.value.isRepo, true)
    assert.equal(result.value.branch, 'main')
    assert.equal(result.value.totals.n, 0)
  })
  await check('rejects an empty commit message', async () => {
    const result = await callRoute(harness.routes, 'gitCommit', { sessionId: 'session-git-1', message: '   ' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid-request')
  })
  await check('commits every dirty file and refreshes state', async () => {
    await writeFile(join(repo, 'file.txt'), 'hello world\n', 'utf8')
    await writeFile(join(repo, 'added.txt'), 'new\n', 'utf8')
    const result = await callRoute(harness.routes, 'gitCommit', { sessionId: 'session-git-1', message: 'update' })
    assert.equal(result.ok, true, result.ok ? '' : result.error.message)
    assert.equal(result.value.totals.n, 0)
  })
  await check('refuses to push without an upstream', async () => {
    const result = await callRoute(harness.routes, 'gitPush', { sessionId: 'session-git-1' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'no-upstream')
  })
  await check('lists local branches only, with slashed names included', async () => {
    await run('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.invalid/x.git'])
    await run('git', ['-C', repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD'])
    await run('git', ['-C', repo, 'branch', 'topic/login'])
    const result = await callRoute(harness.routes, 'gitState', { sessionId: 'session-git-1' })
    assert.equal(result.ok, true, result.ok ? '' : result.error.message)
    const names = result.value.branches.map((item) => item.name)
    assert.ok(names.includes('topic/login'), `slashed local branch must be listed, got ${names.join(', ')}`)
    assert.ok(!names.some((name) => name.startsWith('origin/')), `remote aliases must be hidden, got ${names.join(', ')}`)
    assert.ok(!('remote' in result.value.branches[0]), 'a branch carries no remote flag any more')
  })
  await check('switches branches', async () => {
    const result = await callRoute(harness.routes, 'gitBranchSwitch', { sessionId: 'session-git-1', branch: 'topic/login' })
    assert.equal(result.ok, true, result.ok ? '' : result.error.message)
    assert.equal(result.value.branch, 'topic/login')
  })
  await check('creates and checks out a branch', async () => {
    const result = await callRoute(harness.routes, 'gitBranchCreate', { sessionId: 'session-git-1', name: 'next', base: 'main' })
    assert.equal(result.ok, true, result.ok ? '' : result.error.message)
    assert.equal(result.value.branch, 'next')
  })
  await check('rejects an invalid branch name', async () => {
    const result = await callRoute(harness.routes, 'gitBranchCreate', { sessionId: 'session-git-1', name: 'bad..name', base: 'main' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid-request')
  })
  await check('does not mark the current checkout as blocked when cwd is a subdirectory', async () => {
    const sub = join(repo, 'nested')
    await mkdir(sub, { recursive: true })
    await writeFile(join(sub, 'inside.txt'), 'x\n', 'utf8')
    await run('git', ['-C', repo, 'add', '-A'])
    await run('git', ['-C', repo, 'commit', '-m', 'nested'])
    const subSession = await makeSession('session-git-sub', sub)
    const subHarness = makeCtx({ sessions: [subSession] })
    host.apply(subHarness.ctx)
    const result = await callRoute(subHarness.routes, 'gitState', { sessionId: 'session-git-sub' })
    assert.equal(result.ok, true, result.ok ? '' : result.error.message)
    const currentBranch = result.value.branch
    assert.ok(
      !result.value.blockedBranches.some((item) => item.branch === currentBranch),
      `the branch this checkout holds must not be blocked, got ${JSON.stringify(result.value.blockedBranches)}`
    )
    assert.ok(
      result.value.branches.some((item) => item.name === currentBranch && item.note === undefined),
      'the current branch must carry no "checked out elsewhere" note'
    )
  })

  console.log('\n== git init (plain directory) ==')
  const plainDir = join(sandbox, 'plain-project')
  await mkdir(plainDir, { recursive: true })
  const plainHarness = makeCtx({ sessions: [await makeSession('session-plain-1', plainDir)] })
  host.apply(plainHarness.ctx)
  await check('reports a plain directory as no-repo and initializes it on demand', async () => {
    const before = await callRoute(plainHarness.routes, 'gitState', { sessionId: 'session-plain-1' })
    assert.equal(before.ok, true, before.ok ? '' : before.error.message)
    assert.equal(before.value.isRepo, false)
    assert.equal(before.value.state, 'no-repo')
    const init = await callRoute(plainHarness.routes, 'gitInit', { sessionId: 'session-plain-1' })
    assert.equal(init.ok, true, init.ok ? '' : init.error.message)
    assert.equal(init.value.isRepo, true)
    const again = await callRoute(plainHarness.routes, 'gitInit', { sessionId: 'session-plain-1' })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'already-repo')
  })

  console.log('\n== activation without a connection service ==')
  await check('apply() never throws when connection is absent at load time', async () => {
    const late = makeCtx({ sessions: [gitSession], withConnection: false })
    let threw = null
    try {
      host.apply(late.ctx)
    } catch (error) {
      threw = error
    }
    assert.equal(threw, null, threw === null ? '' : String(threw))
    assert.equal(late.routes.size, 0)
  })
  await check('wires its routes once the connection service appears', async () => {
    const late = makeCtx({ sessions: [gitSession], withConnection: false })
    host.apply(late.ctx)
    late.ctx.provideConnection()
    late.ctx.fireInject()
    assert.equal(late.routes.size, expectedMethods.length)
  })

  console.log('\n== refusal paths ==')
  await check('an unregistered non-Git method has no route at all', async () => {
    assert.equal(harness.routes.has('/api/trashSession'), false)
    assert.equal(harness.routes.has('/api/forkAt'), false)
  })
  await check('a registered route never throws, it returns a coded envelope', async () => {
    const result = await callRoute(harness.routes, 'gitState', { sessionId: '../evil' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid-request')
  })
} finally {
  await rm(sandbox, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
