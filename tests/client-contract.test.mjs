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

async function checkAsync(label, fn) {
  try {
    await fn()
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

/** One compound selector: tag, .class, [attr], [attr="value"] — no combinators. */
function matchesSimple(node, part) {
  const tag = part.match(/^([a-zA-Z][\w-]*)/)
  if (tag !== null && node.tagName !== tag[1].toUpperCase()) return false
  const cls = part.match(/\.([\w-]+)/)
  if (cls !== null && !String(node.className).split(/\s+/).includes(cls[1])) return false
  for (const attr of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (!Object.prototype.hasOwnProperty.call(node.attributes, attr[1])) return false
    if (attr[2] !== undefined && node.attributes[attr[1]] !== attr[2]) return false
  }
  return true
}

/**
 * Selector matching for the fake DOM: comma lists and descendant combinators.
 * The plugin finds its anchor through the header (`[data-conversation-header] button`),
 * so those two are all the fidelity this seam needs.
 */
function matchesSelector(node, selector) {
  return String(selector).split(',').some((one) => {
    const parts = one.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return false
    if (!matchesSimple(node, parts[parts.length - 1])) return false
    let parent = node.parentNode
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      while (parent !== null && !matchesSimple(parent, parts[index])) parent = parent.parentNode
      if (parent === null) return false
      parent = parent.parentNode
    }
    return true
  })
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
    insertBefore(newNode, reference) {
      if (newNode.parentNode !== null) {
        const previous = newNode.parentNode.children.indexOf(newNode)
        if (previous !== -1) newNode.parentNode.children.splice(previous, 1)
      }
      const index = node.children.indexOf(reference)
      newNode.parentNode = node
      if (index === -1) node.children.push(newNode)
      else node.children.splice(index, 0, newNode)
      return newNode
    },
    removeChild(child) {
      const index = node.children.indexOf(child)
      if (index !== -1) node.children.splice(index, 1)
      const tagIndex = styleTags.indexOf(child)
      if (tagIndex !== -1) styleTags.splice(tagIndex, 1)
      child.parentNode = null
      return child
    },
    remove() {
      if (node.parentNode !== null) node.parentNode.removeChild(node)
    },
    get nextSibling() {
      if (node.parentNode === null) return null
      const index = node.parentNode.children.indexOf(node)
      return index === -1 ? null : node.parentNode.children[index + 1] || null
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value)
    },
    getAttribute(name) {
      if (name === 'class') return node.className
      return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null
    },
    removeAttribute(name) {
      delete node.attributes[name]
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
    closest(selector) {
      let current = node
      while (current !== null) {
        if (matchesSelector(current, selector)) return current
        current = current.parentNode
      }
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
  // Real DOM reflects `dataset.plugin = x` into the `data-plugin` attribute; the
  // plugin relies on that when it marks and looks up its stylesheet.
  node.dataset = new Proxy({}, {
    set(_target, key, value) {
      node.attributes['data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = String(value)
      return true
    },
    get(_target, key) {
      return node.attributes['data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())]
    },
    has(_target, key) {
      return ('data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())) in node.attributes
    },
    deleteProperty(_target, key) {
      delete node.attributes['data-' + String(key).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())]
      return true
    }
  })
  return node
}

const styleTags = []

globalThis.document = {
  head: makeElement('head'),
  body: makeElement('body'),
  createElement: makeElement,
  querySelector(selector) {
    const match = selector.match(/^style\[(data-plugin-css|data-plugin)="([^"]+)"\]$/)
    if (match !== null) {
      const attribute = match[1]
      return styleTags.find((tag) => tag.attributes[attribute] === match[2]) || null
    }
    return globalThis.document.body.querySelector(selector)
  },
  querySelectorAll(selector) {
    return globalThis.document.body.querySelectorAll(selector)
  },
  addEventListener() {},
  removeEventListener() {}
}
const headAppendChild = globalThis.document.head.appendChild.bind(globalThis.document.head)
globalThis.document.head.appendChild = function (child) {
  if (child.tagName === 'STYLE') styleTags.push(child)
  return headAppendChild(child)
}

globalThis.window = globalThis
globalThis.innerWidth = 1440
globalThis.innerHeight = 900

// The button is a slot occupant now, so the plugin schedules no interval of its own.
// Stub it anyway: a reintroduced re-anchoring timer should fail loudly, not hang tests.
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

/**
 * Timers are captured, not scheduled: a test drives the clock by hand, so the RPC
 * deadline can be exercised without waiting for it.
 */
const timers = new Map()
let nextTimerId = 1
globalThis.setTimeout = (fn, delay) => {
  const id = nextTimerId
  nextTimerId += 1
  timers.set(id, { fn, delay: delay || 0 })
  return id
}
globalThis.clearTimeout = (id) => {
  timers.delete(id)
}
function flushTimers() {
  const pending = [...timers.values()]
  timers.clear()
  for (const timer of pending) timer.fn()
}

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

function makeCtx(connection) {
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
  const services = {
    slots,
    connection: connection || { rpc: { call: async () => ({ ok: true, value: { version: '0.1.0' } }) } }
  }
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
check('registers the toast overlay and the header button slot', () => {
  assert.deepEqual(registrations.map((r) => r.options.name),
    ['shell.overlay', 'conversation.session.header.utilities'])
})
check('injects the two slots it renders into', () => {
  assert.deepEqual(injected, ['shell.overlay', 'conversation.session.header.utilities'])
})
check('the header button registers ahead of the shell workspace pill', () => {
  const header = registrations.find((r) => r.options.name === 'conversation.session.header.utilities')
  assert.ok(header, 'the header slot must be registered')
  assert.equal(header.options.id, 'codex-parity-git')
  assert.ok(header.options.order < -10,
    'the shell workspace pill occupies order -10, so a smaller order is what puts Git to its left')
})
check('registers a teardown effect', () => {
  assert.equal(effects.length, 1)
  assert.equal(typeof effects[0](), 'function')
})

console.log('\n== styles ==')
check('injects a single style tag keyed by plugin id and stylesheet', () => {
  assert.ok(styleTags.length >= 1, 'expected at least one <style> tag')
  assert.equal(styleTags[0].attributes['data-plugin'], 'dsh-codex-parity')
  assert.equal(styleTags[0].attributes['data-plugin-css'], 'dsh-codex-parity/client.css',
    'the shipped packages dedupe on data-plugin-css; matching them keeps one tag per stylesheet')
  assert.ok(styleTags[0].textContent.includes('.dcp-git-menu{'))
  assert.ok(styleTags[0].textContent.includes('.dcp-git-btn{'))
})
check('uses Source Han Sans at light weight, scaled 1.2x', () => {
  const css = styleTags[0].textContent
  assert.ok(css.includes('思源黑体 Light'), 'the plugin should prefer the installed light family')
  assert.ok(css.includes('"思源黑体"'), 'the base family is the fallback')
  assert.ok(css.includes('font-weight:300'), 'text renders at light weight')
  assert.ok(css.includes('font-size:13.2px'), 'menu rows keep the 1.2x body size')
  assert.ok(css.includes('.dcp-git-menu{position:fixed;z-index:2147483004;width:168px;'), 'the menu frame is 0.75x wide')
  assert.ok(css.includes('.dcp-git-pop{position:fixed;z-index:2147483004;width:168px;'), 'the branch pop frame is 0.75x wide')
  assert.ok(css.includes('.dcp-git-dialog{width:300px;'), 'the dialog frame is 0.75x wide')
  assert.ok(!/width:(224|400)px/.test(css), 'the pre-scale frame sizes must be gone')
  const sizes = [...css.matchAll(/font-size:([0-9.]+)px/g)].map((m) => Number(m[1]))
  // The type scale: 12px UI body, 13.2px rows, and the small/xs end used by hints
  // and notes. Anything outside this set means a stray, un-reviewed size slipped in.
  const tiers = new Set([10.8, 11.4, 12, 12.6, 13.2, 13.8, 15.6])
  const stray = sizes.filter((size) => !tiers.has(size))
  assert.deepEqual(stray, [], `unscaled font sizes remain: ${stray.join(', ')}`)
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
    hasRemote: false,
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
    // Records the call and then runs `after`, the way the real gitAct does once its
    // RPC settles — that is what makes the "commit, then switch" chain testable.
    act: (method, payload, message, target, after) => {
      actCalls.push({ method, payload, message, target })
      if (typeof after === 'function') after()
    }
  }, over)
}

check('1. the commit row reports how many files are uncommitted', () => {
  const markup = seam.gitMenuMarkup(gitState({ totals: { n: 5, add: 31, del: 39 } }))
  assert.ok(markup.includes('未提交 5 个'), 'the dirty count must render on the commit row')
  assert.ok(markup.includes('+31') && markup.includes('-39'), 'the totals must stay visible')
})
check('the 切换分支 row carries its own glyph', () => {
  const markup = seam.gitMenuMarkup(gitState())
  const row = markup.slice(markup.indexOf('data-act="switch"'), markup.indexOf('data-act="init"'))
  assert.ok(row.includes('dcp-git-icon'), 'the switch row needs the list glyph')
  assert.ok(row.includes('width="17"') && row.includes('height="17"'), 'the glyph is scaled 1.2x with the rows')
  assert.ok(row.includes('viewBox="0 0 1024 1024"'), 'the glyph is a 1024-grid icon, not the 24-grid stroke set')
  assert.ok(!row.includes('stroke="currentColor"'), 'a filled glyph must not inherit the stroke wrapper')
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
check('3b. 推送 stays greyed out until the repo has a remote', () => {
  const noRemote = mount('menu', gitState({ hasRemote: false }))
  assert.equal(noRemote.surface.node.querySelector('[data-act="push"]').disabled, true, 'no remote → 推送 disabled')
  noRemote.surface.close()
  const withRemote = mount('menu', gitState({ hasRemote: true }))
  assert.equal(withRemote.surface.node.querySelector('[data-act="push"]').disabled, false, 'with a remote → 推送 enabled')
  withRemote.surface.close()
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
check('6b. a clean tree switches without asking', () => {
  actCalls.length = 0
  document.body.children.length = 0
  const { surface } = mount('branchPop', gitState({ totals: { n: 0, add: 0, del: 0 } }), recordingDeps())
  surface.node.querySelector('[data-branch="topic/login"]').click()
  assert.deepEqual(actCalls.map((c) => c.method), ['gitBranchSwitch'])
  assert.equal(document.body.querySelector('[data-git-choice]'), null, 'a clean tree must not open the warning')
  surface.close()
})
check('6c. uncommitted files warn before switching, and 直接切换 still switches', () => {
  actCalls.length = 0
  document.body.children.length = 0
  const { surface } = mount('branchPop', gitState({ totals: { n: 96, add: 31, del: 39 } }), recordingDeps())
  surface.node.querySelector('[data-branch="topic/login"]').click()
  assert.equal(actCalls.length, 0, 'a dirty tree must not switch before the user chooses')
  const body = document.body.querySelector('.dcp-git-ask')
  assert.ok(body, 'the warning dialog has to open')
  assert.ok(body.textContent.includes('96'), 'the warning states how many files are uncommitted')
  document.body.querySelector('[data-git-choice="switch"]').click()
  assert.deepEqual(actCalls.map((c) => c.method), ['gitBranchSwitch'])
  assert.deepEqual(actCalls[0].payload, { branch: 'topic/login' })
  surface.close()
})
check('6d. 提交后切换 opens the commit dialog and switches only after the commit', () => {
  actCalls.length = 0
  document.body.children.length = 0
  const { surface } = mount('branchPop', gitState({ totals: { n: 4, add: 1, del: 1 } }), recordingDeps())
  surface.node.querySelector('[data-branch="topic/login"]').click()
  document.body.querySelector('[data-git-choice="commit"]').click()
  const input = document.body.querySelector('[data-git-input]')
  assert.ok(input, 'the commit dialog has to open')
  assert.equal(actCalls.length, 0, 'nothing is committed or switched before the message is confirmed')
  input.value = 'fix the thing'
  input.fire('input')
  document.body.querySelector('[data-git-confirm]').click()
  assert.deepEqual(actCalls.map((c) => c.method), ['gitCommit', 'gitBranchSwitch'], 'commit first, then switch')
  assert.deepEqual(actCalls[0].payload, { message: 'fix the thing' })
  assert.deepEqual(actCalls[1].payload, { branch: 'topic/login' })
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
check('the header button is an ordinary slot occupant, not injected DOM', () => {
  assert.ok(source.includes("'conversation.session.header.utilities'"), 'the button registers into the header utilities slot')
  assert.ok(source.includes("id: 'codex-parity-git'"), 'the registration carries the plugin-owned id')
  assert.ok(source.includes('order: HEADER_ORDER'), 'its order is what places it left of the shell pill')
  assert.ok(!source.includes('installGitButton'), 'the DOM-injection installer must be gone')
  assert.ok(!source.includes('data-open-target'), 'the split-control anchor hack must be gone')
  assert.ok(!source.includes('setInterval'), 'the re-anchoring timer must be gone')
})
check('the header button keeps the Git glyph and the plugin class', () => {
  const button = source.slice(source.indexOf('function gitButtonHtml()'), source.indexOf('function installDismissal'))
  assert.ok(button.includes("gitGlyph('git'"), 'the header button swaps to the Git glyph')
  assert.ok(!button.includes("gitIcon('branch'"), 'the branch stroke icon is not the button glyph')
  assert.ok(source.includes('dcp-git-icon'), 'the glyph wrapper class must exist')
  assert.ok(button.includes("className: 'dcp-git-btn'"), 'the button keeps the class its stylesheet targets')
})
check('the removed features leave no trace', () => {
  for (const gone of ['dcp-msg-actions', 'dcp-selbar', 'dcp-editor', 'dcp-ask', 'DeleteSession', 'installSidebarContextMenu', 'AskTab', 'trashSession', 'forkAt', 'promptSession']) {
    assert.ok(!source.includes(gone), `removed feature still present: ${gone}`)
  }
})

console.log('\n== host damage recovery ==')

/**
 * The header the desktop shell renders, so the button has a session to act for and
 * the surfaces have something to position against.
 */
function installHeader() {
  const session = makeElement('div')
  session.setAttribute('data-conversation-session', 'session-4fe7bbef')
  const header = makeElement('header')
  header.setAttribute('data-conversation-header', '')
  const folder = makeElement('button')
  folder.setAttribute('aria-label', '在文件资源管理器中显示')
  header.appendChild(folder)
  session.appendChild(header)
  globalThis.document.body.appendChild(session)
  return { folder }
}
const header = installHeader()
plugin.apply(makeCtx())

/** What `removeOwnedStyles('dsh-codex-parity')` in dsh-client-modules does. */
function removePluginStyles() {
  const tag = document.querySelector('style[data-plugin-css="dsh-codex-parity/client.css"]')
  assert.ok(tag, 'the stylesheet has to be present before it can be removed')
  tag.remove()
  assert.equal(document.querySelector('style[data-plugin-css="dsh-codex-parity/client.css"]'), null,
    'the host removal must have taken effect')
}

check('opening a surface restores a stylesheet the host removed', () => {
  const frame = (open) => {
    removePluginStyles()
    const surface = open()
    const healed = document.querySelector('style[data-plugin-css="dsh-codex-parity/client.css"]')
    assert.ok(healed, 'the surface must re-assert the stylesheet, or it mounts without its fixed positioning')
    assert.ok(healed.textContent.includes('.dcp-git-menu{position:fixed'), 'including the fixed-position surface frames')
    return surface
  }
  const menu = frame(() => seam.mountGitMenu(anchor, gitState(), seam.deps()))
  assert.equal(menu.node.style.position, 'fixed', 'the frame has to stay anchored without the stylesheet')
  menu.close()
  frame(() => seam.mountGitBranchPop(anchor, gitState(), seam.deps())).close()
  frame(() => seam.mountGitDialog({ title: '提交', label: 'Commit message', confirmLabel: '提交', onCancel() {}, onConfirm() {} })).close()
})

check('repeated mounts keep exactly one stylesheet', () => {
  for (let i = 0; i < 3; i += 1) {
    seam.mountGitMenu(anchor, gitState(), seam.deps()).close()
  }
  assert.equal(styleTags.filter((tag) => tag.attributes['data-plugin-css'] === 'dsh-codex-parity/client.css').length, 1,
    'the data-plugin-css guard has to keep the tag count at one')
})

check('the entry button hands the surface its own node as the anchor', () => {
  assert.ok(source.includes('toggleGitMenu(event.currentTarget)'),
    'the slot-rendered button must anchor off the node the host gave it')
})

await checkAsync('the registered slot component renders the button and opens the menu', async () => {
  const ctx = makeCtx({
    rpc: {
      call: async (_channel, method) => ({
        ok: true,
        value: method === 'gitState' ? gitState() : { pushed: true }
      })
    }
  })
  plugin.apply(ctx)

  const occupied = registrations.filter((r) => r.options.name === 'conversation.session.header.utilities')
  assert.ok(occupied.length > 0, 'the header slot must have an occupant to render')
  const component = occupied[occupied.length - 1].component

  // Render it the way the host's header renderer would.
  const vnode = component({})
  assert.equal(vnode.type, 'button', 'the occupant renders a button')
  assert.equal(vnode.props.className, 'dcp-git-btn', 'and it keeps the class the stylesheet targets')
  assert.equal(vnode.props['aria-label'], 'Git 操作')
  assert.ok(vnode.props.dangerouslySetInnerHTML.__html.includes('dcp-git-icon'),
    'the glyph wrapper must be in the rendered markup')

  // Click it. `currentTarget` is the node the host owns, inside the session subtree.
  vnode.props.onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: header.folder })
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve))

  const menu = document.body.querySelector('.dcp-git-menu')
  assert.ok(menu, 'clicking the slot button has to open the menu')
  assert.equal(menu.style.position, 'fixed', 'and it has to be positioned as a floating surface')
})

await checkAsync('a hung RPC fails on its deadline instead of staying pending', async () => {
  // A half-open desktop connection: the call never settles at all.
  plugin.apply(makeCtx({ rpc: { call: () => new Promise(() => {}) } }))
  const pending = plugin.__test.rpcCall('gitState', { sessionId: 'session-4fe7bbef' })
  flushTimers()
  const verdict = await Promise.race([
    pending.then(() => 'resolved', (error) => `rejected:${error.message}`),
    new Promise((resolve) => setImmediate(() => resolve('still-pending')))
  ])
  assert.match(verdict, /^rejected:/, 'the call has to fail rather than hang forever')
  assert.match(verdict, /无响应/, 'the failure has to say the host never answered')
  assert.match(verdict, /gitState/, 'and name the method that was lost')
})

await checkAsync('a timed-out action releases the single-flight guard', async () => {
  let attempts = 0
  plugin.apply(makeCtx({ rpc: { call: () => { attempts += 1; return new Promise(() => {}) } } }))
  const deps = seam.deps()
  deps.act('gitPush', {}, '已推送', header.folder)
  assert.equal(attempts, 1, 'the action has to reach the host once')
  flushTimers()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  deps.act('gitPush', {}, '已推送', header.folder)
  assert.equal(attempts, 2, 'gitBusy must not stay latched, or every later action is silently dropped')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
