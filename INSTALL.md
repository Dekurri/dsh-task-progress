# 安装说明（人类 / AI 助手通用）

本文档给出**可复制执行**的安装步骤，覆盖三种场景：

1. [人类：从 Release 压缩包安装](#1-人类从-release-压缩包安装)（最省事，不需要 git）
2. [人类：从源码安装](#2-人类从源码安装)（可 `git pull` 升级）
3. [AI 助手：按指令自动安装并验证](#3-ai-助手自动安装并验证)（给 agent 的确定性步骤）

之后是[验证](#4-安装后验证)、[升级与卸载](#5-升级与卸载)、[排错](#6-排错)
和[维护者发布流程](#7-维护者发布流程)。

> 安装前请确认：**DSH 0.2.x 或更新**（`jobs` / `slots` / `locale` 客户端服务；在 0.2.1-rc.5 上验证）。
> 插件运行时**零第三方依赖**，不写数据目录，不读凭据，不联网。

---

## 0. 这个插件装的是什么

一个 DSH **bundle 包**（package.json 里带 `dsh.bundle.patch`）。安装它等于：

1. 把 `dsh-task-progress` 链接进当前 profile 的 `node_modules`；
2. 在 profile 的 Cordis 组合里 `insert` 一行 `id: task-progress`；
3. 把 `client.js` 作为 web 客户端模块注入浏览器（`dsh.client.inject` 声明依赖的三个内置模块）。

因此**不需要重启 DSH**：装完后刷新 Web UI，输入卡上方出现卡片即生效；
发一个带进度的命令（见 README「演示」）即可看到它。

---

## 1. 人类：从 Release 压缩包安装

1. 打开 [Releases](https://github.com/Dekurri/dsh-task-progress/releases)，下载最新的 `dsh-task-progress-<版本>.tgz`。
2. 解压到**一个长期存在的目录**（安装是符号链接，删掉源目录插件就失效）：

   ```sh
   # macOS / Linux
   mkdir -p ~/dsh-plugins && tar -xzf dsh-task-progress-0.1.1.tgz -C ~/dsh-plugins

   # Windows PowerShell
   mkdir "$env:USERPROFILE\dsh-plugins"
   tar -xzf dsh-task-progress-0.1.1.tgz -C "$env:USERPROFILE\dsh-plugins"
   ```

   解压后目录里应当直接能看到 `package.json`、`client.js`、`cordis.patch.yml`。

3. 在 DSH 的插件管理界面安装这个 bundle（选择上面的**绝对路径**目录），或者让 DSH 里的 AI 助手执行：

   ```
   plugin_manager install_bundle {"target":"<上面的绝对路径>"}
   ```

4. 成功判据：返回里 `application` 为 `"applied"` 且 `warnings` 为空数组。

## 2. 人类：从源码安装

```sh
git clone https://github.com/Dekurri/dsh-task-progress.git ~/dsh-plugins/dsh-task-progress
cd ~/dsh-plugins/dsh-task-progress
npm install        # 只有测试需要（React SSR），插件本身运行时零依赖
npm run verify     # 静态护栏 + 密钥扫描 + 解析单测 + 渲染测试
```

然后用**绝对路径** `~/dsh-plugins/dsh-task-progress` 安装 bundle（同上）。
升级：`cd ~/dsh-plugins/dsh-task-progress && git pull`，刷新页面即可（link 安装直接指向源码）。

> 也可以让插件管理器直接按 git 规格安装：`plugin_manager install_bundle {"target":"github:Dekurri/dsh-task-progress"}`。
> 这种方式由插件管理器管理检出目录，升级时重新安装即可，不需要手动 git。

## 3. AI 助手：按指令自动安装并验证

把下面整段交给 DSH 里的 agent 即可（步骤是确定性的，不要跳步）：

```
请按下面步骤安装 DSH 插件 dsh-task-progress，并逐步汇报结果：

1) 环境：确认 node >= 20；确认 ~/dsh-plugins 存在（不存在就创建）。
2) 获取源码（二选一）：
   - git clone https://github.com/Dekurri/dsh-task-progress.git ~/dsh-plugins/dsh-task-progress
   - 或下载最新 Release 的 tgz 并解压到 ~/dsh-plugins
3) 如用源码：cd ~/dsh-plugins/dsh-task-progress && npm install && npm run verify（必须全部 PASS）。
4) 安装 bundle：plugin_manager install_bundle，target 用该目录的绝对路径。
   成功判据：返回 application === "applied"、warnings 为空。
5) 验证注册：cordis_inspect_query（platform=client，provider=Slots，method=listSubTree，
   input {"root":"conversation.input.overlay"}），确认 occupants 里出现 id=task-progress、
   order=5、active=true；同时确认 conversation.composer.dock 中没有它。
6) 功能验证：用 bash/ops_bash 后台运行 `python3 demo/progress_demo.py --mode epoch --seconds 60`，
   然后问用户页面上输入卡上沿是否出现带百分比/速度/ETA 的浮动卡片。
7) 如果用户同意，点卡片上的「停止」（两段确认）验证 kill 生效，报告任务最终状态。
8) 最后报告：安装路径、版本、验证结果、以及"视觉外观已/未由用户确认"。
```

注意事项（给助手）：

- 不要手写 profile 的 `package.json` / `cordis.patch.yml`，也不要往 profile 里跑 `pnpm add`；
  一律通过 `install_bundle` 走插件管理器。
- 不要修改 `node_modules` 里的任何文件。
- 安装后不需要重启 DSH；如果页面没变化，让用户刷新一次。

## 4. 安装后验证

| 检查 | 期望 |
|---|---|
| `plugin_manager list_bundles` | 出现 `dsh-task-progress`，`installed: true`、`enabled: true` |
| 客户端槽位 | `conversation.input.overlay` 的 occupants 含 `task-progress`（order 5，active） |
| 空态 | 没有运行中任务时，页面不出现任何卡片、输入框高度不变 |
| 进度态 | 跑 `demo/progress_demo.py` 时出现卡片：百分比/分数 + 进度条 + 速度/ETA/已用 + 停止按钮 |
| 停止 | 两段确认后任务被 kill（工具结果里出现 kill reason） |
| 收起 | 点卡片头部可收起为细横条；不影响输入框与对话区 |

## 5. 升级与卸载

- **本地目录安装（link）**：`git pull` 或换新的 Release 目录后，`install_bundle` 再指向新目录即可；
  改 `client.js` 后刷新页面就生效。
- **git 规格安装**：重新执行一次 `install_bundle`（会重新拉取）。
- **卸载**：`plugin_manager remove_bundle {"target":"dsh-task-progress"}`；确认 `list_bundles` 里不再有它，
  下拉刷新页面，卡片消失（不会影响其它插件与数据：本插件没有数据目录）。

## 6. 排错

| 现象 | 排查 |
|---|---|
| 装完页面没有卡片 | 先确认槽位 occupants 里有 `task-progress`；再确认当前会话有 **running** 的 bash job（前台任务在等待时也算） |
| 卡片在但一直显示「等待输出…」 | 任务的进度输出可能在 stderr 或被重定向到了文件；换 `demo/progress_demo.py` 复现 |
| 百分比/ETA 不出现 | 该格式未被识别（见 README 解析规则表）；把最后几行输出发 issue 即可扩展 |
| 停止按钮无效 | 确认任务仍在 `running`（已结束的任务不做 kill）；查看工具结果里的 kill reason |
| 卡片位置/高度异常 | 确认 DSH 版本为 0.2.x；插件注册在 `conversation.input.overlay`，若宿主改了这个槽位的 CSS 变量，需要跟进适配 |
| `install_bundle` 报版本不满足 | 插件要求 DSH 0.2.x；升级 DSH 后重试 |
| 渲染报错（页面局部空白） | 打开浏览器控制台，搜 `slot entry crashed in 'conversation.input.overlay'`，把堆栈发 issue |

## 7. 维护者发布流程

1. 改代码，`npm run verify` 全过，更新 `CHANGELOG.md`。
2. 改 `package.json` 的 `version`（`release.yml` 会校验 tag 与版本一致）。
3. 提交并推送 `main`，等 CI 绿。
4. 打 tag 并推送：

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

5. `release.yml` 会自动：重新跑护栏与测试 → 校验版本 → `npm pack` → 创建 GitHub Release 并附 tgz。
6. 仓库设置（一次性）：`main` 分支保护要求 `verify bundle` CI 通过、禁止 force push 与删除、
   要求对话解决；单人仓库无法满足 1 个外部 review，因此 review 数设为 0（`CODEOWNERS` 仍指定 owner）。

发布检查清单：

- [ ] `npm run verify` 全过
- [ ] `CHANGELOG.md` 有本次条目，`package.json` 版本已 bump
- [ ] README / CONTRACT 与实际行为一致（尤其 DSH 版本兼容性）
- [ ] Release 附件里有 `dsh-task-progress-<版本>.tgz`，能按本文档装通
