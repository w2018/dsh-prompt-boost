# DSH 插件开发笔记

写这个插件时踩到的坑，按"会让人卡住多久"排序。适用于 DeepSeek Harness 0.2.0-rc.2。

## 一、安装与激活

| 坑 | 说明 |
| --- | --- |
| `pnpm add` ≠ `dsh plugin add` | `pnpm add` 只写 `dependencies` + 建软链；bundle 层是靠 `dsh.profile.bundles` 激活的，不写这个列表插件等于没装 |
| profile 清单只在启动时读 | 改完 `package.json` / `cordis.patch.yml` 必须重启 |
| `engines.dsh` 范围 | 声明了就必须与运行版本兼容，否则安装和启动都会被拒 |
| 从 git 安装不跑 build | pnpm 不会执行 `build`，TS 包到手没有 `lib/`；要么发预构建产物，要么提供 `prepare` 并在 `pnpm-workspace.yaml` 里 `allowBuilds` 授权 |

## 二、Client bundle

| 坑 | 说明 |
| --- | --- |
| `__ModuleLoader__.load` 的 `id` | 必须与 `package.json` 的 `name` **逐字一致**（尾部 `/client` 会被 strip）。写错插件静默不加载，控制台只有一行 `bundle loaded without registering "<id>"` |
| 样式归属 | 自建 `<style>` 必须打 `data-plugin="<包名>"`，否则 DSH 的 `claimStyles` 会算到别的插件头上，对方 HMR 时被一起删掉 |
| 插槽要 `inject` 不要直接 `register` | 插槽由宿主包声明，插件激活时可能还没挂上；`slots.inject(name, cb)` 会在声明出现时再回调一次 |

## 三、插槽与 props

| 插槽 | 用途 | props |
| --- | --- | --- |
| `conversation.input.right` | 输入框右下那一排（模型选择器 / 发送键），`order` 越小越靠左 | `{ useInput, inputActions, sessionId, settingsScope }` |
| `conversation.composer.dock` | 输入框**上方**那一排 | `{ sessionId }` |
| `conversation.session.header.utilities` | 会话标题栏右侧工具区 | — |
| `plugins.bundle.config` | 插件详情页的配置面板，`key` = 包名 | — |
| `settings.section` | 设置页的独立分区，需要 `label` | — |
| `sidebar.footer.action` | 侧边栏底部 | — |

**优先用插槽给的 `useInput` / `inputActions`**，不要自己去 `ctx.sessions.scope()` + `conversation.input.for()` —— 前者是选择器 hook，草稿变化会自动重渲染。

## 四、服务访问

| 坑 | 说明 |
| --- | --- |
| 别写 `ctx.llm` | 未声明 inject 时它是**直接抛错**（`cannot get property "llm" without inject`），不是返回 undefined。`ctx.llm \|\| fallback` 这种写法左边就先炸了，兜底永远走不到。统一用 `ctx.get('llm')` |
| `@deepseek-ai/dsh-llm` 解析不到 | `link:` 安装时插件的模块解析起点是源码目录，找不到宿主包。`createUserMessage` 要 `try { await import(...) }` + 同形状普通对象兜底 |
| `ctx.webServer` | 在 `apply` 里直接访问，但要声明 `inject = ['webServer']`，否则服务未就绪时抛错 |

## 五、React 与配置面板

| 坑 | 说明 |
| --- | --- |
| `useEffect` 依赖里放 `load` | 如果 `load` 依赖 `presets`，每次 `setPresets` 换数组引用都会重新 fetch 并把用户编辑重置（甚至死循环）。effect 空依赖只跑一次，取值函数写成模块级纯函数 |
| jsdom 触发不了 textarea 的 `onChange` | 合成事件依赖浏览器的 value tracker，原生 setter + `dispatchEvent('input')` 在 jsdom 里无效。想测交互就用 `<select>` 的 `change` 事件，或改用真实浏览器 |

## 六、LLM 调用

```js
const llm = ctx.get('llm')
const stream = llm.stream({
  provider, model, messages,
  system, temperature: 0.3, maxTokens: 900,
  signal: AbortSignal.timeout(60000),
  purpose: 'my-plugin',
})
for await (const chunk of stream) {
  if (chunk.type === 'text-delta') raw += chunk.text
  else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') throw new Error(...)
}
```

- `llm.listProviders()` → `[{ id }]`
- `await llm.listModels(providerId)` → `[{ id, name }]`
- `ctx.get('agentDefaultModel').currentSelection()` → `{ provider, model }`（系统设置里的默认模型）
