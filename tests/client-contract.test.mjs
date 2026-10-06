/**
 * Client-half contract test.
 *
 * The client bundle is a browser artifact, so this harness supplies a small DOM,
 * React and Cordis surface and then drives the plugin's real seam — the markup
 * builders and mount functions on `plugin.__test` — instead of grepping the
 * bundle's source text. Assertions here execute behaviour: a mounted menu, a
 * clicked row, a reopened dialog.
 *
 * Run: node tests/client-contract.test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'dist', 'formal-client.cjs'), 'utf8')

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

//#region minimal DOM / React / Cordis

const VOID_TAGS = new Set(['INPUT', 'BR', 'HR', 'IMG'])

/**
 * Parse one markup string into flat nodes. Flat is enough: the plugin only ever
 * looks elements up by attribute, never by structure.
 */
function parseMarkup(html) {
  const nodes = []
  const tag = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\s*\/?>/g
  let match
  while ((match = tag.exec(html)) !== null) {
    const node = makeElement(match[1])
    const attrs = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g
    let attr
    while ((attr = attrs.exec(match[2] || '')) !== null) {
      if (attr[1] === '') continue
      node.attributes[attr[1]] = attr[2] === undefined ? '' : attr[2]
      if (attr[1] === 'class') node.className = attr[2] === undefined ? '' : attr[2]
      if (attr[1] === 'disabled') node.disabled = true
    }
    if (!VOID_TAGS.has(node.tagName)) {
      node.textContent = html.slice(tag.lastIndex).split('<')[0].trim()
    }
    nodes.push(node)
  }
  return nodes
}

function matchesSelector(node, selector) {
  const tag = selector.match(/^([a-zA-Z][\w-]*)/)
  if (tag !== null && node.tagName !== tag[1].toUpperCase()) return false
  const cls = selector.match(/\.([\w-]+)/)
  if (cls !== null && !String(node.className).split(/\s+/).includes(cls[1])) return false
  const attr = selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/)
  if (attr !== null) {
    if (!Object.prototype.hasOwnProperty.call(node.attributes, attr[1])) return false
    if (attr[2] !== undefined && node.attributes[attr[1]] !== attr[2]) return false
  }
  return true
}

function descendants(node, out = []) {
  for (const child of node.children) {
    out.push(child)
    descendants(child, out)
  }
  return out
}

function makeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    value: '',
    disabled: false,
    focused: false,
    parentNode: null,
    __html: '',
    __listeners: {},
    get innerHTML() {
      return node.__html
    },
    set innerHTML(value) {
      node.__html = String(value)
      node.children = parseMarkup(node.__html)
      node.children.forEach((child) => { child.parentNode = node })
    },
    appendChild(child) {
      child.parentNode = node
      node.children.push(child)
      return child
    },
    removeChild(child) {
      const index = node.children.indexOf(child)
      if (index !== -1) node.children.splice(index, 1)
      child.parentNode = null
      return child
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value)
    },
    getAttribute(name) {
      if (name === 'class') return node.className
      return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null
    },
    addEventListener(type, handler) {
      ;(node.__listeners[type] = node.__listeners[type] || []).push(handler)
    },
    removeEventListener() {},
    querySelector(selector) {
      return descendants(node).find((child) => matchesSelector(child, selector)) || null
    },
    querySelectorAll(selector) {
      return descendants(node).filter((child) => matchesSelector(child, selector))
    },
    closest() {
      return null
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 120, bottom: 24, width: 120, height: 24 }
    },
    focus() {
      node.focused = true
    },
    /** Run the listeners for one event type, the way a browser would. */
    fire(type, extra = {}) {
      const event = Object.assign({ target: node, key: undefined }, extra, {
        stopPropagation() {},
        preventDefault() {}
      })
      for (const handler of node.__listeners[type] || []) handler(event)
    },
    click() {
      node.fire('click')
    }
  }
  return node
}

const styleTags = []

globalThis.document = {
  head: makeElement('head'),
  body: makeElement('body'),
  createElement: makeElement,
  querySelector(selector) {
    if (selector.startsWith('style[data-plugin=')) {
      return styleTags.find((tag) => tag.dataset.plugin === selector.split('"')[1]) || null
    }
    return globalThis.document.body.querySelector(selector)
  },
  querySelectorAll(selector) {
    return globalThis.document.body.querySelectorAll(selector)
  },
  addEventListener() {},
  removeEventListener() {}
}
globalThis.document.head.appendChild = function (child) {
  if (child.tagName === 'STYLE') styleTags.push(child)
  return child
}

globalThis.window = globalThis
globalThis.innerWidth = 1440
globalThis.innerHeight = 900
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {}
}
const reactDom = { unmountComponentAtNode: () => true, render: () => true }

const registrations = []
const injected = []
const effects = []
const moduleLoader = { pending: [] }
globalThis.__ModuleLoader__ = {
  load(registration) {
    moduleLoader.pending.push(registration)
  }
}

function makeCtx() {
  const slots = {
    inject(name, cb) {
      injected.push(name)
      if (typeof cb === 'function') cb()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    }
  }
  const services = { slots, connection: { rpc: { call: async () => ({ ok: true, value: { version: '0.1.0' } }) } } }
  return {
    get(name) {
      return services[name]
    },
    effect(fn) {
      effects.push(fn)
    },
    inject(names, callback) {
      callback(services)
      return () => {}
    }
  }
}

//#endregion

function loadClient() {
  const evaluate = new Function('require', 'document', 'window', 'globalThis', source)
  evaluate(
    (specifier) => {
      throw new Error(`unexpected top-level require(${specifier})`)
    },
    globalThis.document,
    globalThis,
    globalThis
  )
  const registration = moduleLoader.pending[0]
  assert.ok(registration, 'the bundle must call __ModuleLoader__.load')
  const req = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react-dom') return reactDom
    throw new Error(`unexpected require(${specifier})`)
  }
  return registration.factory(req)
}

console.log('\n== bundle registration ==')
const plugin = loadClient()
check('registers under the plugin id', () => {
  assert.equal(moduleLoader.pending[0].id, 'dsh-codex-parity')
})
check('exports inject + apply', () => {
  assert.ok(Array.isArray(plugin.inject))
  assert.equal(typeof plugin.apply, 'function')
})
check('hard-requires only the slots service', () => {
  assert.deepEqual(plugin.inject, ['slots'])
})
check('exposes the same kind of test seam as the host half', () => {
  const seam = plugin.__test
  assert.ok(seam, 'the plugin must expose __test')
  for (const name of ['gitMenuMarkup', 'gitBranchPopMarkup', 'gitDialogMarkup', 'mountGitMenu', 'mountGitBranchPop', 'mountGitDialog', 'deps']) {
    assert.equal(typeof seam[name], 'function', `__test.${name} must be a function`)
  }
})

console.log('\n== deployment ==')
check('apply() does not throw with the slots + connection services present', () => {
  plugin.apply(makeCtx())
})
check('registers the toast overlay and nothing else', () => {
  assert.deepEqual(registrations.map((r) => r.options.name), ['shell.overlay'])
})
check('injects only the overlay slot it renders into', () => {
  assert.deepEqual(injected, ['shell.overlay'])
})
check('registers a teardown effect', () => {
  assert.equal(effects.length, 1)
  assert.equal(typeof effects[0](), 'function')
})

console.log('\n== styles ==')
check('injects a single style tag keyed by plugin id', () => {
  assert.ok(styleTags.length >= 1, 'expected at least one <style> tag')
  assert.equal(styleTags[0].dataset.plugin, 'dsh-codex-parity')
  assert.ok(styleTags[0].textContent.includes('.dcp-git-menu{'))
  assert.ok(styleTags[0].textContent.includes('.dcp-git-btn{'))
})
check('uses Source Han Sans at normal weight throughout', () => {
  const css = styleTags[0].textContent
  assert.ok(css.includes('思源黑体 Normal'), 'the plugin should prefer the installed normal family')
  assert.ok(css.includes('"思源黑体"'), 'the base family is the fallback')
  assert.ok(css.includes('font-weight:400'), 'text renders at normal weight')
  assert.ok(!/Outfit|JetBrains Mono/.test(css), 'previous display/mono fonts must be gone')
})

console.log('\n== git menu behaviour ==')

const seam = plugin.__test
const anchor = makeElement('button')

/** A gitState the menu/pop can render. */
function gitState(over = {}) {
  return Object.assign({
    isRepo: true,
    branch: 'main',
    mainBranch: 'main',
    detachedSha: '',
    totals: { n: 0, add: 3, del: 1 },
    branches: [
      { name: 'main', current: true },
      { name: 'topic/login', current: false }
    ],
    blockedBranches: []
  }, over)
}

/** Mount a surface with the real deps, overriding only what the test watches. */
function mount(kind, state, overrides = {}) {
  const deps = Object.assign(seam.deps(), overrides)
  const surface = kind === 'menu' ? seam.mountGitMenu(anchor, state, deps) : seam.mountGitBranchPop(anchor, state, deps)
  return { surface, deps }
}

const actCalls = []
function recordingDeps(over = {}) {
  return Object.assign(seam.deps(), {
    act: (method, payload, message, target) => actCalls.push({ method, payload, message, target })
  }, over)
}

check('1. the commit row reports how many files are uncommitted', () => {
  const markup = seam.gitMenuMarkup(gitState({ totals: { n: 5, add: 31, del: 39 } }))
  assert.ok(markup.includes('未提交 5 个'), 'the dirty count must render on the commit row')
  assert.ok(markup.includes('+31') && markup.includes('-39'), 'the totals must stay visible')
})
check('2. outside a repo only init is available', () => {
  actCalls.length = 0
  const { surface } = mount('menu', gitState({ isRepo: false, branch: null }), recordingDeps())
  assert.equal(surface.node.querySelector('[data-act="init"]').disabled, false)
  for (const act of ['commit', 'push', 'switch']) {
    assert.equal(surface.node.querySelector(`[data-act="${act}"]`).disabled, true, `${act} must be disabled`)
  }
  surface.node.querySelector('[data-act="init"]').click()
  assert.equal(actCalls.length, 1)
  assert.equal(actCalls[0].method, 'gitInit')
  surface.close()
})
check('3. inside a repo init is disabled', () => {
  const { surface } = mount('menu', gitState())
  assert.equal(surface.node.querySelector('[data-act="init"]').disabled, true)
  assert.equal(surface.node.querySelector('[data-act="commit"]').disabled, false)
  surface.close()
})
check('4. the commit row opens a dialog whose confirm needs a message', () => {
  actCalls.length = 0
  document.body.children.length = 0
  const { surface } = mount('menu', gitState(), recordingDeps())
  surface.node.querySelector('[data-act="commit"]').click()
  const confirm = document.body.querySelector('[data-git-confirm]')
  assert.ok(confirm, 'clicking 提交 has to open the dialog')
  assert.equal(confirm.disabled, true, 'an empty message must disable confirm')
  const input = document.body.querySelector('[data-git-input]')
  input.value = 'fix the thing'
  input.fire('input')
  assert.equal(confirm.disabled, false, 'a message must enable confirm')
  confirm.click()
  assert.equal(actCalls[actCalls.length - 1].method, 'gitCommit')
  assert.deepEqual(actCalls[actCalls.length - 1].payload, { message: 'fix the thing' })
  surface.close()
})
check('5. clicking 初始化 calls gitInit', () => {
  actCalls.length = 0
  const { surface } = mount('menu', gitState(), recordingDeps())
  surface.node.querySelector('[data-act="init"]').disabled = false
  surface.node.querySelector('[data-act="init"]').click()
  assert.deepEqual(actCalls.map((c) => c.method), ['gitInit'])
  surface.close()
})
check('6. clicking a branch row switches to that branch', () => {
  actCalls.length = 0
  const { surface } = mount('branchPop', gitState(), recordingDeps())
  surface.node.querySelector('[data-branch="topic/login"]').click()
  assert.equal(actCalls.length, 1)
  assert.equal(actCalls[0].method, 'gitBranchSwitch')
  assert.deepEqual(actCalls[0].payload, { branch: 'topic/login' })
  surface.close()
})
check('7. 创建并切换 opens the naming dialog', () => {
  document.body.children.length = 0
  const { surface } = mount('branchPop', gitState(), recordingDeps())
  surface.node.querySelector('[data-git-create]').click()
  const input = document.body.querySelector('[data-git-input]')
  assert.ok(input, 'the create button has to open a naming dialog')
  const backdrop = document.body.children[document.body.children.length - 1]
  assert.ok(backdrop.innerHTML.includes('新建分支'), 'the dialog must be the branch one')
  surface.close()
})
check('8. every local branch renders, slashed names included', () => {
  const { surface } = mount('branchPop', gitState())
  const names = surface.node.querySelectorAll('[data-branch]').map((node) => node.getAttribute('data-branch'))
  assert.deepEqual(names.sort(), ['main', 'topic/login'])
  assert.ok(!names.some((name) => name.startsWith('origin/')), 'no remote alias may render')
  surface.close()
})
check('9. a blocked branch is rendered as disabled', () => {
  actCalls.length = 0
  const state = gitState({ blockedBranches: [{ branch: 'topic/login', path: 'E:/elsewhere' }] })
  const { surface } = mount('branchPop', state, recordingDeps())
  const row = surface.node.querySelector('[data-branch="topic/login"]')
  assert.equal(row.getAttribute('data-disabled'), '1')
  row.click()
  assert.equal(actCalls.length, 0, 'a blocked branch must not switch')
  surface.close()
})

console.log('\n== wiring that behaviour cannot express ==')
check('the header button is installed and anchored to the workspace pill', () => {
  assert.ok(source.includes('installGitButton()'), 'the header button has to be installed')
  assert.ok(source.includes('data-conversation-header'), 'the button anchors on the conversation header')
  assert.ok(source.includes("closest('[data-open-target]')"), 'it sits outside the workspace split control')
})
check('the removed features leave no trace', () => {
  for (const gone of ['dcp-msg-actions', 'dcp-selbar', 'dcp-editor', 'dcp-ask', 'DeleteSession', 'installSidebarContextMenu', 'AskTab', 'trashSession', 'forkAt', 'promptSession']) {
    assert.ok(!source.includes(gone), `removed feature still present: ${gone}`)
  }
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
