# dsh-codex-parity

为 DeepSeek Harness (DSH Desktop) 加一个 Codex 风格的 Git 面板。

<img width="185" height="203" alt="QQ20261006-164336" src="https://github.com/user-attachments/assets/574006f1-4134-45dc-acaa-17f1aa65c579" />
<img width="206" height="191" alt="QQ20261006-164327" src="https://github.com/user-attachments/assets/74954b22-1cff-486e-af5f-388e804fbe8c" />

插件只做一件事：在会话头部的**工作区 pill 左侧**加一个独立的 Git 按钮，点开是一个轻量菜单。

| 项目 | 说明 |
|------|------|
| **入口** | 会话头部工作区 pill 左侧的「Git」按钮（图标 + 文字，独立于右侧按钮组） |
| **汇总** | 菜单顶部显示当前分支与总增减：`main +154 -117` |
| **菜单项** | 提交 / 推送 / 切换分支 / 初始化 Git（初始化在最下） |
| **提交** | 弹窗填写 commit message，`git add -A` 后提交 |
| **推送** | 推送当前分支；没有 upstream 时提示先手动建立 |
| **切换分支** | 搜索并切换本地分支，当前分支标记勾号，并显示未提交文件数 |
| **创建并切换** | 输入新分支名，以当前分支为基点创建并切换 |
| **初始化 Git** | 目录还不是仓库时可用；已是仓库时按钮置灰 |

非 Git 仓库时，提交 / 推送 / 切换分支置灰，只有初始化可用。

字体统一使用**思源黑体 Light**（回退到思源黑体常规族，再回退系统无衬线），面板整体字号为基准的 1.2 倍。

## 安装

```powershell
dsh plugin --profile desktop add <插件目录>\release\dsh-codex-parity-0.1.0.tgz
```

卸载：

```powershell
dsh plugin --profile desktop remove dsh-codex-parity
```

## 架构

两半，零依赖、无构建步骤：

| 文件 | 职责 |
|------|------|
| `dist/formal-host.mjs` | Git RPC：`ping`、`gitState`、`gitCommit`、`gitPush`、`gitBranchSwitch`、`gitBranchCreate`、`gitInit` |
| `dist/formal-client.cjs` | Git 按钮、菜单、分支与提交弹窗、操作 toast |

工作目录来自会话 header 记录的 `cwd`；所有 Git 操作都在该目录真实执行。

客户端注册两个槽位：`shell.overlay`（操作 toast）与 `conversation.session.header.utilities`（Git 入口按钮）。该槽 `kind: list` 且升序渲染，原生工作区 pill（`open-in-app`）占 `order: -10`；Git 按钮用 `order: -20` 注册，因此落在它紧左侧、独立成组。按钮的 DOM 由宿主渲染持有，插件不做 DOM 注入也不轮询。

菜单与弹窗是挂在 `document.body` 上的浮层，靠内联 `position:fixed` 定位；插件样式表在每次挂载浮层时重新断言，宿主清理后无需重启即可恢复。

## 开发

```powershell
npm test      # 离线测试
node scripts/pack.mjs   # 重新打包 release tarball
```
