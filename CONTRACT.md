# CONTRACT · 与 DSH 的集成契约

本文件记录插件**依赖了 DSH 的哪些内部能力**、为什么可以这样依赖、以及 DSH 升级时应该检查什么。
它是给维护者和 AI 助手看的：改 `client.js` 之前先读这里，不要引入超出契约的依赖。

> 校验基线：DSH `0.2.1-rc.5`（`@deepseek-ai/dsh-api-job-controller`、`@deepseek-ai/dsh-client-ui-conversation`、
> `@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-renderer` 同版本）。
> 行号仅作线索，升级后以符号名为准。

## 1. 插件对外承诺（不变量）

1. **Host 半部为空**：`index.js` 只有 `export function apply() {}`。插件不注册 Host 服务、不写会话日志、
   不新增 event type、不落盘、不联网。
2. **只读数据**：进度数据全部来自 DSH 内置 `jobs` 客户端服务的公开方法（`job.list` / `job.follow` / `job.kill`）。
   插件不直接调用远端 RPC，也不解析会话日志。
3. **只挂一个槽位**：`conversation.input.overlay`，`id: "task-progress"`，`order: 5`，`locale: "task-progress"`。
   不替换任何内置条目的 id，不往 `document.body` 追加节点，不用 iframe。
4. **样式只用主题 token**：`--dsw-alias-*` / `--dsw-specific-*` / `--dsw-elevation-*` / `--dsw-radius-*` 等，
   并带 fallback；不自造颜色体系。`scripts/static-check.mjs` 会强制检查。

以上任何一条被打破，`npm run verify` 应当失败——这是护栏，不是建议。

## 2. 依赖的客户端服务

| 服务 | 来源模块 | 插件用途 |
|---|---|---|
| `jobs` | `@deepseek-ai/dsh-api-job-controller`（client 半部） | `state`（可订阅快照）、`watchRows(sessionId)`、`observe(sessionId, jobId)`、`kill(sessionId, jobId)` |
| `slots` | `@deepseek-ai/dsh-client-ui-slots`（经 ui-conversation 注入） | `inject("conversation.input.overlay", …)` + `register({name,id,order,locale,inject})` |
| `locale` | `@deepseek-ai/dsh-client-locale` | `register(ns, {zh, en})`；`t` 由槽位条目的 `locale` 选项交给组件 |
| `remote` | 由宿主提供（`jobs` 内部依赖，插件不直接碰） | 仅通过 `ctx.jobs` 间接使用 |

`package.json` 的 `dsh.client.inject` 必须与上表一致（额外项会被 static-check 忽略，但不要加无用的）。

## 3. 槽位契约

```js
ctx.slots.inject("conversation.input.overlay", () =>
  ctx.slots.register({
    name: "conversation.input.overlay",
    id: "task-progress",
    order: 5,
    locale: "task-progress",
    inject: () => ({
      hooks: { jobs: ctx.jobs.state },
      watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
      observe: (sessionId, jobId) => ctx.jobs.observe(sessionId, jobId),
      killJob: async (sessionId, jobId) => (await ctx.jobs.kill(sessionId, jobId)).ok,
    }),
  }, TaskProgressDock),
);
```

- 槽位声明（ui-conversation 的 `conversation.view` children）：
  `"conversation.input.overlay": { kind: "list", scope: "session" }`。
- 组件收到的 props：`sessionId`（session scope 标准 props）、`useJobs`（由 `hooks.jobs` 绑定的 selector hook）、
  `watchRows` / `observe` / `killJob`（inject 原样铺入）、`t`（由 `locale` 选项提供）。
- **必须**在 `useEffect` 的 cleanup 里调用 `watchRows` / `observe` 返回的 release 函数，否则引用计数泄漏。
- 该槽位位于输入卡的 `height:0` 浮层锚点内（`data-composer-overlay`），条目的 `position:absolute` 不会改变输入卡高度；
  宿主对该锚点内的点击有 `closest("[data-composer-overlay]")` 保护，不会让输入框失焦。

## 4. 数据契约

### JobView（`job.list` rows / `job.follow` 的 job 字段）

```ts
{
  id: string;
  kind: string;                  // bash / 其它 producer，open string
  label: string;                 // 通常是命令本身
  owner?: string;                // = sessionId
  outputLimitBytes?: number;
  status: "failed" | "running" | "stopping" | "completed" | "killed";
  progress?: string;             // producer 可选实时进度行（bash 工具不写，通常为空）
  detail?: string;               // 终态原因，含 kill reason
  startedAt: number;             // epoch ms
  finishedAt?: number;
  output: { total: number; earliest: number; spillPaths?: string[] };
}
```

### 帧

- `job.follow` 流：`{ type: "opened", job, from }` → `{ type: "output", chunks: [{ at, text, channel?, gapBefore? }], next, lossy? }`
  → `{ type: "status", job }`（终态后结束）。
- `job.kill({ sessionId, jobId })`：`sessionId` 作为 owner fence；成功时任务的 `detail` 会记录 kill reason。

### 客户端快照（`ctx.jobs.state`）

```ts
{
  rows: { [sessionId: string]: JobView[] };
  observed: { [jobId: string]: { jobId, text, gapBefore, streaming, error? } };
}
```

- `observed[id].text` 是**输出尾部**（客户端裁剪到约 128 KiB），插件只取最后约 12000 字符解析。
- 快照对象是不可变的：用 `useJobs(selector)` 取子集，不要直接读 `ctx.jobs.state` 的当前值缓存到组件外。

## 5. 为什么可以只依赖客户端 jobs

- Host 侧 `jobs` 注册表是**工具无关**的：内置 bash 工具与 `dsh-ops` 的 `ops_bash` 都用 `ctx.jobs.start(...)` 注册，
  并且 `agent.id === session.id`（`@deepseek-ai/dsh-agent` 的 `enter()` 校验），所以 `owner` 就是 `sessionId`，
  按会话过滤不会串台。
- bash 工具在任务结束时 `registry.remove(...)`，所以前台 job 只在运行期间出现在 `rows` 里；
  后台任务保留到被移除。卡片「自动消失」正是这个语义。
- `job.progress` 通常为空（bash 工具不调用 `updateProgress`），所以进度必须从输出流解析——这是启发式解析器的由来。

## 6. DSH 升级检查清单

升级 DSH 后按顺序检查（任何一项变化都可能需要改插件）：

1. `@deepseek-ai/dsh-api-job-controller` 的 client 半部是否仍 `provide("jobs", ...)`，
   以及 `watchRows` / `observe` / `kill` 名字与签名是否变化。
2. `job.list` / `job.follow` / `job.kill` 的远端帧字段是否变化（特别是 `JobView` 的 `progress` / `detail` / `output`）。
3. `dsh-client-ui-conversation` 的 `conversation.view` children 里是否仍有
   `"conversation.input.overlay": { kind: "list", scope: "session" }`。
4. 输入卡结构是否仍有 `data-composer-overlay` 锚点（`height:0; position:absolute; inset:0 0 auto`）。
5. 槽位 entry 选项是否仍支持 `locale` 与 `inject.hooks`（renderer 的 `standardKit` / `bindInjectSources`）。
6. 主题 token 名单是否有删改（`static-check.mjs` 的白名单需要同步）。

出现以下任一情况，视为**破坏性变更**，需要在 CHANGELOG 记录并升 major/minor：

- `jobs` 客户端服务改名或不再暴露 `state`；
- `JobView.status` 枚举或 `observe` 语义变化；
- `conversation.input.overlay` 槽位被移除/改 scope；
- renderer 不再把 `hooks` 绑定成 `useX`。

## 7. 隐私契约

- 任务输出只在本页面内存中解析，发往任何地方都不行；插件不调用 `fetch`、不打开 WebSocket。
- 不读取 `localStorage` / cookie / `process.env` / 会话日志。
- 不写任何文件：插件没有数据目录，卸载/禁用后不残留状态。
