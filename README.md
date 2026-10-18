# dsh-prompt-boost

DeepSeek Harness 的提示词增强插件。

输入框右下角、模型选择器左边会多一个 ✨。点一下，当前草稿被改写成更清楚的版本并写回输入框；不满意可以撤回。

不需要配 API Key —— 模型和凭证直接用 DSH 设置里已经配好的那份。

```
帮我做个报表
        ↓ ✨
请帮我制作一份数据报表，明确主题与使用场景、数据来源与字段、核心指标与维度、
呈现形式（表格/图表/看板），以及是否需要按时间或分类做对比。
信息不全时，先列出需要我提供的字段。
```

## 安装

要求 DSH 0.1.7-rc.2 以上，并且已经在「设置 → 模型」里配好至少一个提供商。

桌面端：插件管理 → 从本地目录添加 → 选中本目录 → 启用 → 重启 DSH。

命令行：

```bash
dsh plugin --profile <profile> add /path/to/dsh-prompt-boost

# 或者直接从 GitHub 装
dsh plugin --profile <profile> add github:w2018/dsh-prompt-boost
```

别用 `pnpm add`。它只把包装进 `dependencies`，不会写 `dsh.profile.bundles`，而插件是靠这个列表激活的，装了也不会加载。已经这么干过的话，把包名补进列表末尾再重启。

## 使用

输入框有内容时按钮才出现，空着的时候不显示。

点 ✨，草稿被替换，按钮变成「撤回」，30 秒内点它能还原。你一旦手动改草稿，撤回就失效 —— 避免冲掉你的编辑。

## 模板

插件管理 → 增强提示词 → 配置。下拉框里有六个：

- 🌟 通用结构化 —— 清晰目标、格式约束，默认
- 💻 编程与技术专家 —— 架构设计、边界异常、规范
- ✍️ 文案与内容创作 —— 去 AI 腔调、生动语感、吸引力
- 🔬 严谨推理与研究 —— 深度思维链、辩证反例、自洽
- ⚡ 极简精练 —— 剔除废话、直奔核心、高信噪比
- 🛠 自定义提示词 —— 自己写规则

选中哪个就哪个生效，下一次点 ✨ 用它。

想改：选一个模板，编辑器里是它的完整内容，改完点「保存为自定义模板」，下拉框会自动切到自定义。内置模板不会被覆盖，所以升级插件不会冲掉你的改动。

「查看完整系统提示词」会展开真正发给模型的 system prompt：内置基础部分 + 你的模板，包含还没保存的改动。

## 换模型

默认跟随 DSH 的默认模型。想固定，改 `~/.dsh/profiles/<profile>/cordis.patch.yml`：

```yaml
- id: dsh-prompt-boost
  name: "dsh-prompt-boost"
  config:
    provider: deepseek-official
    model: deepseek-flash
```

patch 是整行替换 `config` 而不是合并，用到的键要写全。

## 出问题

- **按钮不出现**：输入框得先有字；确认包名在 `dsh.profile.bundles` 里；改完配置要重启。
- **报「DSH LLM 服务不可用」或「找不到可用的模型路由」**：设置 → 模型 里没有能用的提供商。
- **报「自定义模板还是空的」**：模板切到了自定义，但内容没填。

## 开发

```bash
node test/smoke.mjs "帮我做个报表"     # Host 路由与模板逻辑
node test/load.mjs                     # 双端加载自检（在 profile 目录下跑）
PB_TEST_DEPS=<装了 react/jsdom 的 node_modules> node test/panel.mjs   # 配置面板 UI
```

以 `link:` 方式装进 profile 时，改完重启 DSH 就生效，不用重新安装。

写插件时踩的坑记在 [docs/DSH插件开发笔记.md](docs/DSH插件开发笔记.md)。

## 发布

`scripts/release.sh` 从 `package.json` 读版本号，打 `v<version>` 标签、推送，再创建 GitHub Release。
发版前先把 `package.json` 的 `version` 改成新版本号。

## License

MIT
