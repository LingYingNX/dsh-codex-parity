/**
 * Live verification against a running DSH host.
 *
 * Calls the plugin's Git routes over real HTTP through the same trust fence the
 * browser uses, and asserts the responses are well-formed. Proves the shipped
 * artifact is what actually serves requests, not just what the unit tests mock.
 *
 * Usage:
 *   node tests/live-verify.mjs <origin> <token>
 *   node tests/live-verify.mjs http://127.0.0.1:4388 -yyZA9J-...
 */

const origin = process.argv[2]
const token = process.argv[3]

if (origin === undefined || token === undefined) {
  console.error('usage: node tests/live-verify.mjs <origin> <token>')
  process.exit(2)
}

let passed = 0
let failed = 0

function check(label, fn) {
  try {
    fn()
    passed += 1
    console.log(`  PASS  ${label}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${label}\n        ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function login() {
  const response = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookie = response.headers.getSetCookie?.() ?? []
  return cookie.map((row) => row.split(';')[0]).join('; ')
}

const cookie = await login()
console.log(`\n== auth ==`)
check('obtains a trust-fence cookie', () => assert(cookie.length > 0, 'no Set-Cookie returned'))

async function authedRpc(method, payload) {
  const response = await fetch(`${origin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `live-${method}`, method, payload: payload ?? {} })
  })
  return { status: response.status, body: await response.json() }
}

console.log('\n== the Git routes are mounted (200, not 404) ==')
const methods = ['ping', 'gitState', 'gitCommit', 'gitPush', 'gitBranchSwitch', 'gitBranchCreate', 'gitInit']
for (const method of methods) {
  const result = await authedRpc(method, {})
  check(`/api/${method} responds 200`, () => assert(result.status === 200, `HTTP ${result.status}`))
}

console.log('\n== the removed features are gone (404) ==')
for (const method of ['forkAt', 'promptSession', 'readTail', 'trashSession', 'listTrash', 'restoreTrash', 'purgeTrash', 'gitDiff']) {
  const result = await authedRpc(method, {})
  check(`/api/${method} is not mounted`, () => assert(result.status === 404, `HTTP ${result.status}`))
}

console.log('\n== ping ==')
const ping = await authedRpc('ping')
check('reports ok with the plugin version', () => {
  assert(ping.body.result.ok === true, `not ok: ${JSON.stringify(ping.body.result)}`)
  assert(ping.body.result.value.version === '0.1.0', `unexpected version ${ping.body.result.value.version}`)
})

console.log('\n== hostile input is refused with a coded error ==')
const hostile = [
  ['gitState', { sessionId: '../../etc/passwd' }, 'invalid-request'],
  ['gitState', { sessionId: 'a/b' }, 'invalid-request'],
  ['gitState', { sessionId: '' }, 'invalid-request'],
  ['gitCommit', { sessionId: 's', message: '   ' }, 'invalid-request'],
  ['gitBranchCreate', { sessionId: 's', name: 'bad..name', base: 'main' }, 'invalid-request']
]
for (const [method, payload, code] of hostile) {
  const result = await authedRpc(method, payload)
  check(`${method} rejects ${JSON.stringify(payload)} → ${code}`, () => {
    assert(result.body.result.ok === false, 'expected a refusal')
    assert(result.body.result.error.code === code, `got code ${result.body.result.error.code}`)
  })
}

console.log('\n== a session with no recorded cwd is a coded error, not a crash ==')
const missing = await authedRpc('gitState', { sessionId: 'no-such-session' })
check('missing session → coded error', () => {
  assert(missing.body.result.ok === false, 'expected a refusal')
  assert(typeof missing.body.result.error.message === 'string')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
