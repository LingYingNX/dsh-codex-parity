/**
 * Host-half tests. No DSH host required: the module's pure helpers are exercised directly.
 *
 * Run: node tests/host.test.mjs
 */

import assert from 'node:assert/strict'

const host = await import('../dist/formal-host.mjs')
const { assertSafeId, parseStatus, parseWorktrees, VERSION } = host.__test

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

console.log('\n== plugin contract ==')
check('exports name', () => assert.equal(host.name, 'dsh-codex-parity'))
check('exports apply()', () => assert.equal(typeof host.apply, 'function'))
check('version is reported', () => assert.equal(VERSION, '0.1.0'))
check('inject is empty so the plugin always activates', () => {
  assert.ok(Array.isArray(host.inject))
  assert.deepEqual(
    host.inject,
    [],
    'a hard-required service makes the loader mark the plugin "pending" and apply() never runs'
  )
})
check('only the Git helpers are exported', () => {
  assert.deepEqual(
    Object.keys(host.__test).sort(),
    ['VERSION', 'assertSafeId', 'gitState', 'parseStatus', 'parseWorktrees']
  )
})

console.log('\n== id hardening ==')
check('accepts a normal session id', () => {
  assert.equal(assertSafeId('session-0f2a-11ee'), 'session-0f2a-11ee')
})
check('trims surrounding whitespace', () => {
  assert.equal(assertSafeId('  session-1  '), 'session-1')
})
for (const bad of ['', '   ', '../etc', 'a/b', 'a\\b', '.', '..', 'a\u0000b', null, 42, undefined]) {
  check(`rejects ${JSON.stringify(bad)}`, () => assert.throws(() => assertSafeId(bad)))
}

console.log('\n== worktree parsing ==')
check('parses worktrees with their branches', () => {
  const rows = parseWorktrees(
    'worktree E:/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree E:/other\nHEAD def456\ndetached\n'
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { path: 'E:/repo', branch: 'main' })
  assert.deepEqual(rows[1], { path: 'E:/other', branch: null })
})

console.log('\n== status parsing ==')
check('folds numstat counts onto porcelain paths and skips the branch header', () => {
  const stats = parseStatus(
    '## main...origin/main\n M src/a.js\n?? src/b.js\n',
    '3\t1\tsrc/a.js\n-\t-\tsrc/b.js\n'
  )
  assert.deepEqual(stats, [{ add: 3, del: 1 }, { add: 0, del: 0 }])
})
check('handles a rename by folding the destination path counts', () => {
  const stats = parseStatus('## main\nR  old.txt -> new.txt\n', '4\t2\tnew.txt\n')
  assert.deepEqual(stats, [{ add: 4, del: 2 }])
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
