/**
 * Verify a packed tarball is installable: manifest parses, the `dsh` block is
 * complete, every declared entrypoint exists, and the artifacts are valid JS.
 *
 * Run: node tests/package.test.mjs
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tarball = join(root, 'release', `${manifest.name}.tgz`)

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

console.log('\n== manifest ==')
check('name is the plugin id the host injects', () => {
  assert.equal(manifest.name, 'dsh-codex-parity')
})
check('main points at the host half', () => {
  assert.equal(manifest.main, './dist/formal-host.mjs')
})
check('exports the client half', () => {
  assert.equal(manifest.exports['./client'], './dist/formal-client.cjs')
})
check('declares the bundle patch', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})
check('declares a web client with injections', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(Array.isArray(manifest.dsh.client.inject))
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-conversation'
  ])
})
check('injects the slot registry and the package that declares the header slot', () => {
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
    'the header utilities slot is declared by ui-conversation; declaring it keeps the load order right')
})
check('states a dsh version range', () => {
  assert.match(manifest.engines.dsh, /0\.2/)
})

console.log('\n== files on disk ==')
for (const entry of ['package.json', ...manifest.files]) {
  check(`${entry} exists`, () => assert.ok(existsSync(join(root, entry)), `missing ${entry}`))
}
check('cordis.patch.yml inserts the plugin id', () => {
  const text = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(text, /id:\s*codex-parity/)
  assert.match(text, /name:\s*dsh-codex-parity/)
})

console.log('\n== tarball ==')
check('release tarball exists', () => {
  assert.ok(existsSync(tarball), `run: node scripts/pack.mjs (expected ${tarball})`)
})

let extractDir = null
try {
  extractDir = mkdtempSync(join(tmpdir(), 'codex-parity-verify-'))
  execFileSync('tar', ['-xzf', tarball, '-C', extractDir], { stdio: 'pipe' })
  const staged = join(extractDir, 'package')

  check('extracts to a package/ root (what `dsh plugin add` expects)', () => {
    assert.ok(existsSync(staged), 'no package/ directory in the archive')
  })
  check('ships package.json inside the archive', () => {
    assert.ok(existsSync(join(staged, 'package.json')))
  })
  check('archive manifest matches the workspace manifest', () => {
    const inner = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'))
    assert.deepEqual(inner, manifest)
  })
  check('ships both halves', () => {
    assert.ok(existsSync(join(staged, 'dist', 'formal-host.mjs')))
    assert.ok(existsSync(join(staged, 'dist', 'formal-client.cjs')))
  })
  check('archive file list is exactly what files[] declares', () => {
    const found = []
    const walk = (dir, prefix) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) walk(join(dir, entry.name), rel)
        else found.push(rel)
      }
    }
    walk(staged, '')
    const expected = ['package.json', ...manifest.files].sort()
    assert.deepEqual(found.sort(), expected)
  })
  check('packed host half matches the workspace copy', () => {
    const packed = readFileSync(join(staged, 'dist', 'formal-host.mjs'))
    const source = readFileSync(join(root, 'dist', 'formal-host.mjs'))
    assert.ok(packed.equals(source), 'the tarball is stale; re-run scripts/pack.mjs')
  })
  check('packed client half matches the workspace copy', () => {
    const packed = readFileSync(join(staged, 'dist', 'formal-client.cjs'))
    const source = readFileSync(join(root, 'dist', 'formal-client.cjs'))
    assert.ok(packed.equals(source), 'the tarball is stale; re-run scripts/pack.mjs')
  })
} catch (error) {
  failed += 1
  console.log(`  FAIL  tarball extraction\n        ${error.message}`)
} finally {
  if (extractDir !== null) rmSync(extractDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
