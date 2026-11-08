# AGENTS.md · 给 AI 助手的维护须知

本文件写给在此仓库里工作的 AI agent。**先读 `CONTRACT.md`，再改 `client.js`。**
这里的规则是硬约束，不是风格偏好。

## 仓库是什么

DSH（DeepSeek Harness）的插件 bundle：`client.js` 在浏览器里往 `conversation.input.overlay` 槽位注册一个浮动卡片，
实时显示当前会话运行中 bash 任务的进度；`index.js` 是空 Host 半部。**没有后端、没有服务、没有数据目录。**

## 改代码前必须知道的约束

1. **Host 半部保持为空**。不要为了「更方便」在 `index.js` 里注册服务、写文件、发 HTTP、劫持事件。
   本插件的数据来源固定为客户端 `ctx.jobs`，这是它能保持零依赖、零落盘的原因。
2. **不 require Harness 内部包**。client 半部只允许 `require("react")`（宿主注入的模块表）。
   `scripts/static-check.mjs` 会拒绝 `@deepseek-ai/dsh-client-*` 的 require——那是给内置包用的。
3. **样式只用主题 token**：`--dsw-alias-*` / `--dsw-specific-*` / `--dsw-elevation-*` / `--dsw-radius-*` 等，
   必须带 fallback；不要硬编码色值（`static-check.mjs` 有 token 白名单）。
4. **不新增槽位、不替换别的插件**。只注册 `conversation.input.overlay` 的 `task-progress` 条目。
   不要往 `conversation.chat.node` 塞新 kind（宿主 key 表固定），不要覆盖内置 `tool.call.toolview` 的 bash 卡。
5. **不碰 DOM 外部世界**：不 append `document.body`、不用 iframe / 第二份 React、不写 localStorage / cookie。
   组件内渲染的 `<style>` 标签随组件卸载自动移除，这是允许的。
6. **locale 必须双语齐全**：新增可见文案时同时加 `zh` 与 `en` 字典项（`test/render.test.mjs` 会检查
   `t("literal.key")` 全部存在）。

## 数据契约要点

- `ctx.jobs.state` 快照：`rows[sessionId]` 是 `JobView[]`，`observed[jobId]` 是输出尾部。
- `watchRows(sessionId)` / `observe(sessionId, jobId)` 返回 **release 函数**，必须在 `useEffect` cleanup 里调用。
- `ctx.jobs.kill(sessionId, jobId)` 返回 `{ ok, value | error }`；UI 只认 `.ok`。
- `JobView.status` 只有 `failed | running | stopping | completed | killed`；卡片只展示 running / stopping。
- `job.progress` 通常为空（bash 工具不写），所以**进度只能从 `observed[].text` 尾部解析**。
- 解析函数（`parseProgressLine` / `analyzeJob` / …）位于 `client.js` 中 `const ANSI_RE = ` 与
  `function isLive(job)` 之间，`test/parse.test.mjs` 直接从发布文件里抽这段执行——**不要移动这两个标记**。

## 改完必须跑

```sh
npm run verify     # static-check + secret-scan + parse + render（全部必须 PASS）
npm run pack:check # npm pack --dry-run，确认 tgz 里只含预期文件
```

- 改了 `client.js` 的 UI/样式：还要在真实 DSH 里用 `demo/progress_demo.py --mode epoch --seconds 60`
  手动看一次（SSR 测试证明不了视觉）。
- 改了 DSH 相关 API 用法：同步更新 `CONTRACT.md` 的依赖表/检查清单。
- 改了行为：更新 `CHANGELOG.md` 的 `[Unreleased]`；发版时改 `package.json` 版本并打 `v*` tag。

## 安装/调试（本机）

- 本机是 link 安装：profile 直接指向本目录，改文件后**刷新页面**即可，不需要重新安装。
- 诊断用 `plugin_manager list_bundles`（看 installed/enabled）与
  `cordis_inspect_query` client `Slots.listSubTree`（看 `conversation.input.overlay` 的 occupants）。
- 渲染异常在浏览器控制台搜 `slot entry crashed in 'conversation.input.overlay'`，宿主没有可读日志接口。

## 不要做的事

- 不要提交 `node_modules`、`dist`、`*.tgz`、`.tmp` 或任何本机绝对路径（`secret-scan.mjs` 会失败）。
- 不要改 profile 目录里的 `package.json` / `cordis.patch.yml` / `node_modules`（安装只走 `install_bundle`）。
- 不要用 `git push --force`、不要删除 `main`、不要跳过 CI 合并。
- 不要在 README/文档里写未验证的行为；本插件是启发式解析，措辞要保留「启发式/常见格式」的边界。
