/**
 * dsh-codex-parity — client half.
 *
 * One feature: the Git menu. A Git button sits immediately left of the
 * conversation header's workspace pill and opens a lightweight menu:
 * commit / push / switch branch / init repo, plus a create-and-switch dialog.
 *
 * Loaded as a Cordis client plugin through `window.__ModuleLoader__.load`, so
 * the whole body is an IIFE whose factory receives `require`. Only `react` and
 * `react-dom` are required, and only for the operation toast.
 */
;(function () {
  var pluginId = 'dsh-codex-parity'

  var factory = function (require) {
    var React = require('react')
    var ReactDOM = require('react-dom')

    var RPC_CHANNEL = '/codex-parity'
    var LOG = '[dsh-codex-parity]'

    //#region styles

    var CSS = [
      '.dcp-toast{position:fixed;left:50%;bottom:28px;z-index:2147483000;transform:translateX(-50%);',
      'display:flex;align-items:center;gap:12px;max-width:min(600px,calc(100vw - 32px));',
      'padding:10px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
      'background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));',
      'color:var(--dsw-alias-label-primary);font-family:"思源黑体 Light","思源黑体","Source Han Sans SC","Source Han Sans Medium","Noto Sans SC","Microsoft YaHei",sans-serif;font-weight:300;font-size:15.6px;line-height:1.5;',
      'box-shadow:0 8px 30px rgba(0,0,0,.22)}',
      '.dcp-toast[data-tone="error"]{border-color:var(--dsw-alias-error,var(--dsw-alias-border-l2))}',
      '.dcp-git-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;margin-right:8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,6px);background:none;color:var(--dsw-alias-label-primary);font-family:"思源黑体 Light","思源黑体","Source Han Sans SC","Source Han Sans Medium","Noto Sans SC","Microsoft YaHei",sans-serif;font-weight:300;font-size:13.2px;line-height:16px;cursor:pointer}',
      '.dcp-git-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}',
      '.dcp-git-summary{display:flex;align-items:baseline;gap:6px;padding:7px 8px;border-bottom:1px solid #EFF1EF;font-family:"思源黑体 Light","思源黑体","Source Han Sans SC","Source Han Sans Medium","Noto Sans SC","Microsoft YaHei",sans-serif;font-weight:300;font-size:13.2px;line-height:1.2;color:#15181A;white-space:nowrap}',
      '.dcp-git-branch{font-weight:400;overflow:hidden;text-overflow:ellipsis}',
      '.dcp-git-counts{display:flex;align-items:baseline;gap:5px;margin-left:auto;font-size:12px}',
      '.dcp-git-add{color:#1F7A44}',
      '.dcp-git-del{color:#C93B32}',
      // Width must stay in step with GIT_PANEL_WIDTH: the CSS sizes the panel,
      // the constant keeps it inside the viewport when it is placed.
      '.dcp-git-menu{position:fixed;z-index:2147483004;width:168px;padding:4px;border:1px solid #E3E6E4;border-radius:12px;background:#FFFFFF;',
      'box-shadow:0 1px 2px rgba(16,24,20,.04),0 18px 36px -16px rgba(16,24,20,.18);font-family:"思源黑体 Light","思源黑体","Source Han Sans SC","Source Han Sans Medium","Noto Sans SC","Microsoft YaHei",sans-serif;font-weight:300}',
      '.dcp-git-menu-title{padding:6px 8px 2px;font-size:12px;line-height:1.2;color:#8A9094;font-family:inherit}',
      '.dcp-git-item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:13.2px;line-height:1.25;color:#15181A;cursor:pointer;text-align:left}',
      '.dcp-git-item:hover:not(:disabled){background:#F1F4F1}',
      '.dcp-git-item[data-primary="1"]{color:#3F6212}',
      '.dcp-git-item[data-primary="1"]:hover{background:rgba(184,224,99,.14)}',
      '.dcp-git-item:disabled{color:rgba(118,126,129,.55);cursor:not-allowed}',
      '.dcp-git-hint{flex:none;font-size:10.8px;color:#8A9094}',
      '.dcp-git-item:disabled .dcp-git-hint{color:rgba(118,126,129,.55)}',
      '.dcp-git-icon{flex:none;display:block;opacity:.75}',
      '.dcp-git-btext{min-width:0}',
      '.dcp-git-check{flex:none;display:flex;color:#3F6212}',
      '.dcp-git-brow[data-disabled="1"] .dcp-git-check{color:#9AA0A3}',
      '.dcp-git-pop{position:fixed;z-index:2147483004;width:168px;padding:4px;border:1px solid #E3E6E4;border-radius:12px;background:#FFFFFF;',
      'box-shadow:0 1px 2px rgba(16,24,20,.04),0 18px 36px -16px rgba(16,24,20,.18);font-family:"思源黑体 Light","思源黑体","Source Han Sans SC","Source Han Sans Medium","Noto Sans SC","Microsoft YaHei",sans-serif;font-weight:300}',
      '.dcp-git-search{box-sizing:border-box;display:block;width:100%;padding:4px 8px;border:1px solid #E9ECEA;border-radius:6px;background:#F6F8F6;font-family:inherit;font-size:12.6px;line-height:1.35;color:#15181A;outline:none}',
      '.dcp-git-search::placeholder{color:#9AA0A3}',
      '.dcp-git-search:focus{border-color:#C9D0CB;background:#FFFFFF}',
      '.dcp-git-create{display:block;width:100%;margin-top:6px;padding:4px 8px;border:1px solid #E1E7DC;border-radius:6px;background:#FBFDF8;font:inherit;font-size:12.6px;line-height:1.35;color:#3F6212;cursor:pointer;text-align:left}',
      '.dcp-git-create:hover{background:rgba(184,224,99,.14);border-color:#CDDCC0}',
      '.dcp-git-list{margin-top:2px;max-height:200px;overflow:auto}',
      '.dcp-git-brow{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:6px;background:transparent;font:inherit;cursor:pointer;text-align:left}',
      '.dcp-git-brow:hover{background:#F1F4F1}',
      '.dcp-git-brow[data-disabled="1"]{cursor:not-allowed;color:#767E81}',
      '.dcp-git-bname{font-family:inherit;font-size:13.2px;color:#15181A}',
      '.dcp-git-brow[data-on="1"] .dcp-git-bname{color:#3F6212;font-weight:300}',
      '.dcp-git-bnote{display:block;font-size:10.8px;color:#8A9094;margin-top:1px;line-height:1.3}',
      '.dcp-git-empty{padding:8px;text-align:center;font-size:12.6px;color:#8A9094}',
      '.dcp-git-backdrop{position:fixed;inset:0;z-index:2147483005;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}',
      '.dcp-git-dialog{width:300px;border:1px solid #E3E6E4;border-radius:12px;background:#FFFFFF;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,20,.04),0 24px 44px -18px rgba(16,24,20,.24);font-family:"思源黑体 Light","思源黑体","Source Han Sans SC","Source Han Sans Medium","Noto Sans SC","Microsoft YaHei",sans-serif;font-weight:300}',
      '.dcp-git-dhead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #EFF1EF;font-size:13.8px;line-height:1.3;font-weight:400}',
      '.dcp-git-dbody{padding:12px;display:flex;flex-direction:column;gap:10px}',
      '.dcp-git-field{display:flex;flex-direction:column;gap:6px}',
      '.dcp-git-field label{font-size:11.4px;color:#8A9094}',
      '.dcp-git-field input,.dcp-git-field select{padding:6px 9px;border:1px solid #E9ECEA;border-radius:6px;background:#F6F8F6;font-family:inherit;font-size:12.6px;line-height:1.35;color:#15181A;outline:none}',
      '.dcp-git-field input:focus,.dcp-git-field select:focus{border-color:#C9D0CB;background:#FFFFFF}',
      '.dcp-git-warn{padding:7px 9px;border:1px solid #E9ECEA;border-radius:6px;background:#F6F8F6;font-size:11.4px;line-height:1.45;color:#8A9094}',
      '.dcp-git-dfoot{display:flex;justify-content:flex-end;gap:6px;padding:10px 12px;border-top:1px solid #EFF1EF;background:#FAFBFA}',
      '.dcp-git-btn2{padding:5px 12px;border:1px solid #E3E6E4;border-radius:6px;background:#FFFFFF;font:inherit;font-size:12.6px;line-height:1.35;color:#4F575A;cursor:pointer}',
      '.dcp-git-btn2:hover{background:#F1F4F1}',
      '.dcp-git-btn2[data-primary="1"]{border-color:transparent;background:#B8E063;color:#152309;font-weight:400}',
      '.dcp-git-btn2[data-primary="1"]:hover{background:#A5CE4E}',
      '.dcp-git-x{width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:#8A9094;font-size:12.6px;line-height:1;cursor:pointer}',
      '.dcp-git-x:hover{background:#E8ECE9;color:#15181A}',
      '.dcp-git-brow[data-disabled="1"] .dcp-git-bname{color:#9AA0A3}'
    ].join('')

    function insertStyles() {
      if (typeof document === 'undefined') return
      var tag = document.querySelector('style[data-plugin="' + pluginId + '"]')
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.plugin = pluginId
        document.head.appendChild(tag)
      }
      tag.textContent = CSS
    }

    //#endregion

    //#region state

    var state = {
      connection: null,
      toast: null
    }

    var listeners = new Set()

    function emit() {
      state = Object.assign({}, state)
      listeners.forEach(function (listener) {
        listener()
      })
    }

    function subscribe(listener) {
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    }

    /** Shared snapshot hook so the toast re-renders from one store. */
    function useSnapshot(select) {
      var pair = React.useState(0)
      var bump = pair[1]
      React.useEffect(function () {
        return subscribe(function () {
          bump(function (n) {
            return n + 1
          })
        })
      }, [])
      return select(state)
    }

    //#endregion

    //#region rpc

    function rpcCall(method, payload) {
      var connection = state.connection
      if (connection === null || connection.rpc === undefined) {
        return Promise.reject(new Error('连接尚未就绪'))
      }
      var body = payload === undefined ? {} : payload
      var invoke = function (channel) {
        return connection.rpc.call(channel, method, body)
      }
      return invoke('/api').catch(function (error) {
        var message = error instanceof Error ? error.message : String(error)
        if (!/HTTP (404|405)/.test(message)) throw error
        return invoke(RPC_CHANNEL)
      }).then(function (result) {
        if (result !== null && typeof result === 'object') {
          if (result.ok === true && 'value' in result) return result.value
          if (result.ok === false) {
            var failure = new Error((result.error && result.error.message) || 'Host 调用失败')
            failure.code = (result.error && result.error.code) || 'error'
            throw failure
          }
          if (result.__error !== undefined) {
            var legacy = new Error(result.__error.message || 'Host 调用失败')
            legacy.code = result.__error.code || 'error'
            throw legacy
          }
        }
        return result
      })
    }

    //#endregion

    //#region toast

    var TOAST_MS = 7000

    function showToast(message, options) {
      var settings = options || {}
      var token = {
        message: message,
        tone: settings.tone || 'info'
      }
      state.toast = token
      emit()
      globalThis.setTimeout(function () {
        if (state.toast === token) {
          state.toast = null
          emit()
        }
      }, TOAST_MS)
    }

    function ToastHost() {
      var current = useSnapshot(function (snapshot) {
        return snapshot.toast
      })
      if (current === null) return null
      return React.createElement('div', {
        className: 'dcp-toast',
        'data-tone': current.tone,
        role: current.tone === 'error' ? 'alert' : 'status'
      }, React.createElement('span', null, current.message))
    }

    //#endregion

    //#region helpers

    function unmountNode(node) {
      try {
        ReactDOM.unmountComponentAtNode(node)
      } catch (error) {
        /* nothing was mounted here */
      }
      if (node.parentNode !== null) node.parentNode.removeChild(node)
    }

    //#endregion

    //#region git menu

    /**
     * Git menu — the button sits left of the workspace pill and opens a
     * lightweight menu: commit / push / switch branch / init repo. Everything
     * goes through the host's git RPCs.
     */
    var gitMenu = null
    var gitPop = null
    var gitDialog = null
    var gitStateData = null
    var gitBusy = false
    var GIT_PANEL_WIDTH = 168

    /**
     * The session the Git button belongs to: the one in the header's own
     * conversation container, falling back to whichever session is on screen.
     * Desktop builds expose the id as `data-conversation-session`; older ones
     * used `data-session-id` on the frame.
     */
    function gitSessionId(anchor) {
      if (typeof document === 'undefined') return null
      var scoped = anchor && anchor.closest ? anchor.closest('[data-conversation-session]') : null
      var id = scoped === null ? null : scoped.getAttribute('data-conversation-session') || scoped.getAttribute('data-session-id')
      if (typeof id === 'string' && id !== '') return id
      var node = document.querySelector('[data-conversation-session],[data-session-id]')
      if (node === null) return null
      id = node.getAttribute('data-conversation-session') || node.getAttribute('data-session-id')
      return typeof id === 'string' && id !== '' ? id : null
    }

    var GIT_ICONS = {
      check: '<polyline points="20 6 9 17 4 12"></polyline>'
    }

    function gitIcon(name, size) {
      var box = size || 14
      return '<svg width="' + box + '" height="' + box + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (GIT_ICONS[name] || '') + '</svg>'
    }

    /**
     * Filled glyphs on the 1024 grid the host shell ships its own icons on. They need
     * their own wrapper: `gitIcon` above is a 24-grid stroke icon and would render
     * these paths far too small. `fill="currentColor"` keeps the glyph in step with
     * the row's text colour, greying out with it when the row is disabled.
     */
    var GIT_GLYPHS = {
      list: '<path d="M216 768 128 768 128 682.666666 216 682.666666 216 768 216 768 216 768ZM312 768 896 768 896 682.666666 312 682.666666 312 768 312 768 312 768ZM216 554.666666 128 554.666666 128 469.333334 216 469.333334 216 554.666666 216 554.666666 216 554.666666ZM312 554.666666 896 554.666666 896 469.333334 312 469.333334 312 554.666666 312 554.666666 312 554.666666ZM216 341.333334 128 341.333334 128 256 216 256 216 341.333334 216 341.333334 216 341.333334ZM312 341.333334 896 341.333334 896 256 312 256 312 341.333334 312 341.333334 312 341.333334Z" fill="currentColor"></path>',
      git: '<path d="M1004.72704 466.4L557.62304 19.328a65.952 65.952 0 0 0-93.28 0L360.47104 123.2l78.176 78.176a96 96 0 0 1 128 128l127.968 127.968a96 96 0 1 1-45.248 45.248l-127.968-127.968a88.832 88.832 0 0 1-9.376 3.872v266.976a96 96 0 1 1-64 0v-266.976a96 96 0 0 1-54.624-131.904L315.22304 168.416 19.31904 464.288a65.952 65.952 0 0 0 0 93.28l447.136 447.072a65.952 65.952 0 0 0 93.28 0l444.992-444.992a65.952 65.952 0 0 0 0-93.28z" fill="currentColor"></path>'
    }

    function gitGlyph(name, size) {
      var box = size || 14
      return '<svg class="dcp-git-icon" width="' + box + '" height="' + box + '" viewBox="0 0 1024 1024" fill="none" aria-hidden="true">' + (GIT_GLYPHS[name] || '') + '</svg>'
    }

    function gitEscape(value) {
      return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
      })
    }

    function closeGitSurface() {
      if (gitMenu !== null) {
        unmountNode(gitMenu)
        gitMenu = null
      }
      if (gitPop !== null) {
        unmountNode(gitPop)
        gitPop = null
      }
      if (gitDialog !== null) {
        unmountNode(gitDialog)
        gitDialog = null
      }
    }

    function gitRefresh(anchor) {
      var sessionId = gitSessionId(anchor)
      if (sessionId === null) return Promise.resolve(null)
      return rpcCall('gitState', { sessionId: sessionId }).then(function (state) {
        gitStateData = state
        return state
      }).catch(function (error) {
        showToast('Git 菜单：' + error.message, { tone: 'error' })
        return null
      })
    }

    /** Host call that mutates the repo, then a refresh + toast. */
    function gitAct(method, payload, message, anchor) {
      if (gitBusy) return
      var sessionId = gitSessionId(anchor)
      if (sessionId === null) return
      gitBusy = true
      var body = Object.assign({ sessionId: sessionId }, payload)
      rpcCall(method, body).then(function () {
        gitBusy = false
        showToast(message)
        return gitRefresh(anchor)
      }).catch(function (error) {
        gitBusy = false
        showToast('Git 操作失败：' + error.message, { tone: 'error' })
      })
    }

    function gitPlace(node, anchor) {
      var rect = anchor.getBoundingClientRect()
      var box = node.getBoundingClientRect()
      var left = Math.max(10, Math.min(rect.right - GIT_PANEL_WIDTH, globalThis.innerWidth - GIT_PANEL_WIDTH - 10))
      var top = rect.bottom + 6
      if (top + box.height > globalThis.innerHeight - 10) top = Math.max(10, rect.top - box.height - 6)
      node.style.left = left + 'px'
      node.style.top = top + 'px'
    }

    /**
     * Markup builders, split out of the mount functions so a test can assert what
     * a given gitState renders without a DOM. Everything user-supplied is escaped
     * here, at the one place the markup is produced.
     */
    function gitMenuMarkup(state) {
      var isRepo = state.isRepo !== false
      var summary = isRepo
        ? '<span class="dcp-git-branch">' + gitEscape(state.branch || 'HEAD') + '</span>' +
          '<span class="dcp-git-counts">' +
            '<span class="dcp-git-add">+' + state.totals.add + '</span>' +
            '<span class="dcp-git-del">-' + state.totals.del + '</span>' +
          '</span>'
        : '<span class="dcp-git-branch">未初始化 Git 仓库</span>'
      var dirtyCount = isRepo && state.totals.n > 0
        ? '<span class="dcp-git-hint">未提交 ' + state.totals.n + ' 个</span>'
        : ''
      return '<div class="dcp-git-summary">' + summary + '</div>' +
        '<button type="button" class="dcp-git-item" data-act="commit"' + (isRepo ? '' : ' disabled') + '><span>提交</span>' + dirtyCount + '</button>' +
        '<button type="button" class="dcp-git-item" data-act="push"' + (isRepo ? '' : ' disabled') + '><span>推送</span></button>' +
        '<button type="button" class="dcp-git-item" data-act="switch"' + (isRepo ? '' : ' disabled') + '><span>切换分支</span>' + gitGlyph('list', 17) + '</button>' +
        '<button type="button" class="dcp-git-item" data-act="init"' + (isRepo ? ' disabled' : '') + '><span>初始化 Git</span></button>'
    }

    function gitBranchPopMarkup() {
      return '<input class="dcp-git-search" placeholder="搜索分支" data-git-search>' +
        '<button type="button" class="dcp-git-create" data-git-create>创建并切换</button>' +
        '<div class="dcp-git-menu-title">分支</div><div class="dcp-git-list" data-git-branches></div>'
    }

    /** One text-input dialog shared by the branch-create and commit flows. */
    function gitDialogMarkup(spec) {
      return '<div class="dcp-git-dialog">' +
        '<div class="dcp-git-dhead"><span>' + gitEscape(spec.title) + '</span>' +
        '<button type="button" class="dcp-git-x" data-git-cancel>✕</button></div>' +
        '<div class="dcp-git-dbody">' +
          '<div class="dcp-git-field"><label>' + gitEscape(spec.label) + '</label>' +
            '<input data-git-input placeholder="' + gitEscape(spec.placeholder) + '"></div>' +
          (spec.warn === undefined ? '' : '<div class="dcp-git-warn"><span>' + gitEscape(spec.warn) + '</span></div>') +
        '</div>' +
        '<div class="dcp-git-dfoot"><button type="button" class="dcp-git-btn2" data-git-cancel>取消</button>' +
        '<button type="button" class="dcp-git-btn2" data-primary="1" data-git-confirm disabled>' + gitEscape(spec.confirmLabel) + '</button></div>' +
      '</div>'
    }

    /**
     * Mount the menu. `deps` carries the data boundary (`act`) and the two
     * neighbouring surfaces, so a caller — or a test — can stand in for any of
     * them. Returns the node and its closer; ownership of "what is open" stays
     * with the caller (`closeGitSurface`).
     */
    function mountGitMenu(anchor, state, deps) {
      var menu = document.createElement('div')
      menu.className = 'dcp-git-menu'
      menu.innerHTML = gitMenuMarkup(state)
      document.body.appendChild(menu)
      gitPlace(menu, anchor)
      Array.prototype.forEach.call(menu.querySelectorAll('[data-act]'), function (node) {
        node.addEventListener('click', function (event) {
          event.stopPropagation()
          if (node.disabled === true) return
          var act = node.getAttribute('data-act')
          deps.close()
          if (act === 'init') deps.act('gitInit', {}, '已初始化 Git 仓库', anchor)
          else if (act === 'commit') deps.openCommitDialog(anchor)
          else if (act === 'push') deps.act('gitPush', {}, '已推送', anchor)
          else if (act === 'switch') deps.openBranchPop(anchor, state)
        })
      })
      return { node: menu, close: function () { unmountNode(menu) } }
    }

    /** The branch list, its search box and the create-and-switch flow. */
    function mountGitBranchPop(anchor, state, deps) {
      var pop = document.createElement('div')
      pop.className = 'dcp-git-pop'
      pop.innerHTML = gitBranchPopMarkup()
      document.body.appendChild(pop)
      gitPlace(pop, anchor)
      var blockedNames = {}
      ;(state.blockedBranches || []).forEach(function (item) { blockedNames[item.branch] = item.path })
      var searchInput = pop.querySelector('[data-git-search]')
      var createButton = pop.querySelector('[data-git-create]')
      function draw(keyword) {
        var list = pop.querySelector('[data-git-branches]')
        var query = (keyword || '').trim().toLowerCase()
        var rows = (state.branches || []).filter(function (item) { return item.name.toLowerCase().indexOf(query) >= 0 })
        if (rows.length === 0) { list.innerHTML = '<div class="dcp-git-empty">没有匹配的分支</div>'; return }
        list.innerHTML = rows.map(function (item) {
          var on = item.current === true
          var disabled = blockedNames[item.name] !== undefined
          var dirtyNote = on && state.totals.n > 0 ? '<span class="dcp-git-bnote">未提交: ' + state.totals.n + ' 个文件</span>' : ''
          return '<button type="button" class="dcp-git-brow" data-branch="' + gitEscape(item.name) + '"' + (disabled ? ' data-disabled="1"' : '') + (on ? ' data-on="1"' : '') + '>' +
            '<span class="dcp-git-btext"><span class="dcp-git-bname">' + gitEscape(item.name) + '</span>' +
            (dirtyNote || (item.note ? '<span class="dcp-git-bnote">' + gitEscape(item.note) + '</span>' : '')) + '</span>' +
            (on ? '<span class="dcp-git-check">' + gitIcon('check', 14) + '</span>' : '') + '</button>'
        }).join('')
        Array.prototype.forEach.call(list.querySelectorAll('[data-branch]'), function (node) {
          node.addEventListener('click', function () {
            if (node.getAttribute('data-disabled') === '1') return
            var branch = node.getAttribute('data-branch')
            deps.close()
            deps.act('gitBranchSwitch', { branch: branch }, '已切换到分支 ' + branch, anchor)
          })
        })
      }
      draw('')
      searchInput.addEventListener('input', function (event) {
        draw(event.target.value)
      })
      createButton.addEventListener('click', function () { deps.openCreateDialog(anchor, state) })
      globalThis.setTimeout(function () { searchInput.focus() }, 40)
      return { node: pop, close: function () { unmountNode(pop) } }
    }

    /** The shared naming/message dialog. */
    function mountGitDialog(spec) {
      var dialog = document.createElement('div')
      dialog.className = 'dcp-git-backdrop'
      dialog.innerHTML = gitDialogMarkup(spec)
      document.body.appendChild(dialog)
      var cancel = function () { spec.onCancel() }
      dialog.addEventListener('mousedown', function (event) { if (event.target === dialog) cancel() })
      Array.prototype.forEach.call(dialog.querySelectorAll('[data-git-cancel]'), function (node) {
        node.addEventListener('click', cancel)
      })
      var input = dialog.querySelector('[data-git-input]')
      var confirm = dialog.querySelector('[data-git-confirm]')
      var submit = function () {
        var value = input.value.trim()
        if (value === '') return
        spec.onConfirm(value)
      }
      input.addEventListener('input', function () {
        confirm.disabled = input.value.trim() === ''
      })
      input.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        submit()
      })
      confirm.addEventListener('click', submit)
      globalThis.setTimeout(function () { input.focus() }, 40)
      return { node: dialog, close: function () { unmountNode(dialog) } }
    }

    /**
     * The real deps every surface mounts with outside of a test: the RPC action, the
     * toast, the closer and the neighbouring surfaces. Each neighbour reads this same
     * object, so overriding one entry in a test reaches the whole chain.
     */
    function gitSurfaceDeps(overrides) {
      var deps = {
        act: gitAct,
        toast: showToast,
        close: closeGitSurface,
        openBranchPop: null,
        openCommitDialog: null,
        openCreateDialog: null
      }
      deps.openBranchPop = function (anchor) { openGitBranchPop(anchor, deps) }
      deps.openCommitDialog = function (anchor) { openGitCommitDialog(anchor, deps) }
      deps.openCreateDialog = function (anchor, state) { openGitBranchCreateDialog(anchor, state, deps) }
      return Object.assign(deps, overrides || {})
    }

    /** Thin wrappers: fetch, mount, and record which surface is open. */
    function toggleGitMenu(anchor) {
      if (gitMenu !== null) { closeGitSurface(); return }
      closeGitSurface()
      gitRefresh(anchor).then(function (state) {
        if (state === null || gitMenu !== null) return
        gitMenu = mountGitMenu(anchor, state, gitSurfaceDeps()).node
      })
    }

    function openGitBranchPop(anchor, deps) {
      var state = gitStateData
      if (state === null) return
      deps.close()
      gitPop = mountGitBranchPop(anchor, state, deps).node
    }

    function openGitCommitDialog(anchor, deps) {
      deps.close()
      gitDialog = mountGitDialog({
        title: '提交',
        label: 'Commit message',
        placeholder: '填写提交信息',
        confirmLabel: '提交',
        warn: '将暂存全部未提交文件（git add -A）',
        onCancel: deps.close,
        onConfirm: function (message) {
          deps.act('gitCommit', { message: message }, '已提交', anchor)
          deps.close()
        }
      }).node
    }

    function openGitBranchCreateDialog(anchor, state, deps) {
      deps.close()
      gitDialog = mountGitDialog({
        title: '新建分支',
        label: '分支名',
        placeholder: '例如 feature/login',
        confirmLabel: '创建并切换',
        onCancel: deps.close,
        onConfirm: function (branch) {
          var base = state.branch || state.mainBranch || state.detachedSha || ''
          if (base === '') {
            deps.toast('无法确定基点分支', { tone: 'error' })
            return
          }
          deps.close()
          deps.act('gitBranchCreate', { name: branch, base: base }, '已创建并切换到分支 ' + branch, anchor)
        }
      }).node
    }

    /** Keep our button immediately left of the shell's workspace pill. */
    function installGitButton() {
      if (typeof document === 'undefined') return function () {}
      var mount = function () {
        var folder = null
        var buttons = document.querySelectorAll('[data-conversation-header] button, [data-conversation-header-corner] button')
        for (var index = 0; index < buttons.length; index += 1) {
          var label = buttons[index].getAttribute('aria-label') || ''
          if (/文件资源管理器|open in|folder/i.test(label)) { folder = buttons[index]; break }
        }
        if (folder === null) return
        // The folder button lives inside a Tooltip inside the split control;
        // anchor on the split itself so the Git button stays outside it.
        var group = folder.closest ? folder.closest('[data-open-target]') : null
        if (group === null || group === folder) group = folder
        var existing = document.querySelector('.dcp-git-btn')
        if (existing !== null) {
          if (existing.nextSibling !== group) group.parentNode.insertBefore(existing, group)
          return
        }
        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'dcp-git-btn'
        button.setAttribute('aria-label', 'Git 操作')
        button.innerHTML = gitGlyph('git', 14) + '<span>Git</span>'
        button.addEventListener('mousedown', function (event) { event.preventDefault() })
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          toggleGitMenu(button)
        })
        group.parentNode.insertBefore(button, group)
      }
      mount()
      var timer = globalThis.setInterval(mount, 1500)
      var onDown = function (event) {
        if (gitMenu === null && gitPop === null && gitDialog === null) return
        if (event.target.closest && (event.target.closest('.dcp-git-btn') !== null ||
          event.target.closest('.dcp-git-menu, .dcp-git-pop, .dcp-git-backdrop') !== null)) return
        closeGitSurface()
      }
      var onKey = function (event) { if (event.key === 'Escape') closeGitSurface() }
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('keydown', onKey, true)
      return function () {
        globalThis.clearInterval(timer)
        document.removeEventListener('mousedown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
        closeGitSurface()
        var button = document.querySelector('.dcp-git-btn')
        if (button !== null && button.parentNode !== null) button.parentNode.removeChild(button)
      }
    }

    //#endregion

    //#region plugin body

    return {
      // Only `slots` is hard-required, and only for the operation toast.
      inject: ['slots'],
      // The seam a test drives: the markup builders, the mount functions and the
      // real deps. Mirrors the host half's `export const __test`.
      __test: {
        gitMenuMarkup: gitMenuMarkup,
        gitBranchPopMarkup: gitBranchPopMarkup,
        gitDialogMarkup: gitDialogMarkup,
        mountGitMenu: mountGitMenu,
        mountGitBranchPop: mountGitBranchPop,
        mountGitDialog: mountGitDialog,
        deps: gitSurfaceDeps
      },
      apply: function (ctx) {
        state.connection = ctx.get('connection') || null

        // `connection` belongs to a sibling entry that may activate after this
        // one, so re-sample it when it arrives. Reading it once left the menu
        // unable to reach the host in the desktop build.
        ctx.inject(['connection'], function (scope) {
          state.connection = scope.connection || null
          emit()
        })

        insertStyles()

        var releaseGitButton = installGitButton()

        var slots = ctx.get('slots')
        slots.inject('shell.overlay', function () {
          return slots.register({ name: 'shell.overlay', id: 'codex-parity-toast' }, ToastHost)
        })

        ctx.effect(function () {
          return function () {
            releaseGitButton()
            listeners.clear()
          }
        }, 'dsh-codex-parity: client lifetime')

        console.log(LOG + ' client ready')
      }
    }
  }

  globalThis.__ModuleLoader__.load({ id: pluginId, factory: factory })
})()
