# dsh-task-progress · DSH 任务进度卡

[DeepSeek Harness](https://github.com/deepseek-ai) 插件：在输入框上沿浮动显示当前会话里正在运行的任务进度
（`pip install`、`tqdm` 循环、模型训练 epoch 等），带进度条、百分比/分数、速度、预计剩余、已用时长和一键停止。

纯前端实现，运行时零依赖：数据来自 DSH 内置 `jobs` 客户端服务的推送流，不轮询、不发网络请求、不落盘。

## 特性

- **自动出现/消失**：只看当前会话 `running` / `stopping` 的任务，没有运行中任务时不渲染、不占位。
- **多格式解析**：tqdm 进度条、带标签分数（`Epoch 3/10`、`step 120/1000`、`1/132 项`）、裸百分比、pip 安装阶段；
  同一行同时有 epoch 和 step 时用更细的 step 当主进度，epoch 放进详情行。
- **速度 / ETA / 已用时长**：tqdm 自带 rate 或由样本估算；预计剩余按 tqdm 的 `<mm:ss>` 或已用时间外推。
- **一键停止**：两段确认（3 秒内点第二次），走 DSH 的任务 kill 通道，停止中显示「停止中…」并禁用按钮。
- **不打扰输入**：注册在 `conversation.input.overlay` 浮动层，绝对定位在输入卡上方，展开/收起不改变输入框高度。
- **多任务折叠**：默认展开 2 个运行中任务，其余折叠为「还有 N 个」，可整卡收起。
- **中英双语 + 主题自适应**：跟随 DSH 界面语言与亮/暗主题，支持 `prefers-reduced-motion`。

## 安装

需要 **DSH 0.2.x**（在 `0.2.1-rc.5` 上验证），插件运行时无第三方依赖。

1. 从 [Releases](https://github.com/Dekurri/dsh-task-progress/releases) 下载 `dsh-task-progress-<版本>.tgz`，
   解压到一个长期存在的目录（安装是符号链接，删掉源目录插件就失效）。
2. 用 DSH 插件管理器按**绝对路径**安装这个目录（GUI 插件管理界面，或让 AI 助手调用
   `plugin_manager install_bundle`，target 传该绝对路径）。
3. 也可以直接 `git clone` 源码目录后用同样方式安装；或让插件管理器按 git 规格安装
   （`plugin_manager install_bundle`，target 为 `github:Dekurri/dsh-task-progress`）。

成功判据：返回结果里 `application` 为 `"applied"`；安装后输入框上方出现卡片即可。
卸载：`plugin_manager remove_bundle`，target 为 `dsh-task-progress`。

## 使用

不需要额外操作——在 DSH 里跑任何会输出进度的命令即可，例如：

```sh
pip install torch
python train.py          # 输出 Epoch 3/10 / step 120/1000 之类
```

卡片会自动出现；点「停止」两次可取消任务。前台命令（agent 正在等结果）和后台任务都支持，
多个任务同时跑时会显示前 2 个并折叠其余。

## 兼容性

- DSH 0.2.x，在 `0.2.1-rc.5` 上验证。
- 依赖的客户端模块在 `package.json` 的 `dsh.client.inject` 中声明：
  `@deepseek-ai/dsh-api-job-controller`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-conversation`。
- 插件跟随 DSH 版本：如果 DSH 修改了 `jobs` 客户端服务或 `job.*` 帧格式，可能需要同步升级。

## 限制

- 进度解析是**启发式**的，覆盖常见 tqdm / pip / 训练日志格式；不认识的格式只显示阶段与最后一行输出。
- 只在**当前会话**显示，不展示其他会话或历史任务。
- 前台任务结束会从注册表移除，卡片同时消失（不会保留「已完成」记录）。

## 协议

[MIT](./LICENSE) © 2026 Dekurri
