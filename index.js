/**
 * dsh-prompt-boost —— Host 半端
 *
 * 模型来源：**直接复用 DSH 系统设置里已配置的提供商与凭证**（`ctx.llm.stream`）。
 * 不需要填 API Key、不需要填 baseUrl —— 凭证、代理、重试全部由 DSH 自己管。
 *
 * 路由：
 *   POST /api/prompt-boost/enhance    { text }              → { ok, text, provider, model, preset }
 *   GET  /api/prompt-boost/info                              → { ok, provider, model, preset }
 *   GET  /api/prompt-boost/settings                          → { ok, preset, customPrompt, presets }
 *   POST /api/prompt-boost/settings   { preset, customPrompt } → { ok }
 *
 * 设置持久化在 `$DSH_HOME/storages/prompt-boost.json`（默认 ~/.dsh/storages/）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-prompt-boost'

// 只声明 webServer：llm 走 ctx.get 惰性读取，服务缺失时降级成清晰报错，
// 而不是让整个插件卡在 PENDING。
export const inject = ['webServer']

// ── 基础提示词（与 WorkBuddy 内置「增强提示词」逐字一致）───────────
const BASE_SYSTEM_PROMPT = `You are a Prompt Engineering Expert specializing in improving user prompts for a development code assistant. When given a prompt, analyze and enhance it to create a more effective version while maintaining its core purpose. The requests are being made to an AI assistant that specializes in writing code.

TASK: When given a prompt, analyze and enhance it to create a more effective version while maintaining its core purpose. The requests are being made to an AI assistant that specializes in writing code.

ANALYSIS PROCESS:

Evaluate the original prompt:
Identify the main objective
Note any ambiguities or gaps
Assess the clarity of instructions
Check for missing context
Apply these prompt engineering principles:
Write clear, specific instructions
Include necessary context
Set explicit parameters and constraints
Structure the output format
Add relevant examples
Match tone and complexity to the use case
Remove redundant information
Create the enhanced version:
Maintain the original goal
Incorporate identified improvements
Ensure clarity and completeness
Be realistic in the features to add
Do NOT request guides/how-tos unless the user asks
Do NOT ask for code snippets
Do NOT suggest specific technologies unless mentioned in the user's prompt
Do NOT explain HOW to do things, focus on WHAT
Do NOT answer questions - expand/rewrite them to be more detailed
IMPORTANT CONSTRAINTS:
1. Language matching is the highest priority - You MUST strictly respond in the exact same language as the user's input. If the user writes in Chinese, respond in Chinese; if the user writes in English, respond in English; if the user uses another language, respond in that same language. Do not mix languages unless the user's input itself mixes languages.
2. Keep the enhanced prompt concise - maximum length should be around 800 characters
FORMAT: Provide only the enhanced prompt with no additional commentary.`

const USER_TEMPLATE = `You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.

USER INPUT:
{input}

TASK:
Rewrite the user input into a clearer, more specific prompt for the target AI assistant.

CRITICAL PRIORITY - LANGUAGE CONSISTENCY:
1. You MUST detect the language of the user input above and write the enhanced prompt in that same language.
2. If the user writes in Chinese, the enhanced prompt MUST be entirely in Chinese.
3. If the user writes in English, the enhanced prompt MUST be entirely in English.
4. If the user writes in any other language, the enhanced prompt MUST use that exact same language.
5. If the user mixes languages, keep a natural matching mix. Do not translate the user's intent into a single language.
6. These language rules are behavior instructions only; never include language analysis or language labels in the output.

ENHANCEMENT REQUIREMENTS:
1. Return only the enhanced prompt text; do not add explanations, prefaces, markdown fences, labels, or analysis.
2. Do not include language labels or meta notes such as "User input is in Chinese" or "Response must be in Chinese".
3. Preserve the user's original intent, topic, constraints, and target output type. Do not answer the request.
4. Always make a substantive enhancement when possible: clarify the task, scope, constraints, and expected output.
5. If the original prompt is already clear, lightly polish it instead of returning it unchanged.
6. Keep the enhanced prompt complete and concise. Do not end with an unfinished list, dangling conjunction, or trailing colon.
7. Do not add unrelated requirements, unsupported facts, or unnecessary sections.`

// ── 预设模板：id / 图标 / 标题 / 副标题 / 追加到基础提示词的风格指令 ──
const PRESETS = [
  {
    id: 'general',
    icon: '🌟',
    label: '通用结构化',
    hint: '清晰目标/格式约束/默认推荐',
    directive: `STYLE DIRECTIVE — 通用结构化（默认）：
补齐三件事：① 明确目标与验收标准；② 约束范围与边界（做什么、不做什么）；③ 指定输出格式与粒度。
结构用短句或编号列表，不要写成一大段散文。信息不足时把缺的项列为"待确认"，不要编造。`,
  },
  {
    id: 'code',
    icon: '💻',
    label: '编程与技术专家',
    hint: '架构设计/边界异常/规范',
    directive: `STYLE DIRECTIVE — 编程与技术专家：
以资深工程师视角改写：说清技术上下文与现有约束、期望的架构层次与模块边界、异常与边界条件的处理要求、代码规范与兼容性要求、以及验证方式（如何判定做对了）。
不要替用户选技术栈；只在用户已提及的技术范围内提要求。`,
  },
  {
    id: 'copy',
    icon: '✍️',
    label: '文案与内容创作',
    hint: '去AI腔调/生动语感/吸引力',
    directive: `STYLE DIRECTIVE — 文案与内容创作：
明确受众、渠道、篇幅、语气与行动号召。要求表达具体、有画面感、有节奏，去掉"赋能/打造/一站式"这类空转词与排比套话。
把"要吸引人"翻译成可执行的要求：开头如何抓注意、中段给什么证据、结尾怎么收。`,
  },
  {
    id: 'research',
    icon: '🔬',
    label: '严谨推理与研究',
    hint: '深度思维链/辩证反例/自洽',
    directive: `STYLE DIRECTIVE — 严谨推理与研究：
要求给出推理链条而非结论堆砌：明确前提与假设、区分事实与推断、列出至少一个反例或替代解释、说明结论的适用边界与不确定性。
禁止在缺乏依据时下断言；证据不足要显式标注。`,
  },
  {
    id: 'minimal',
    icon: '⚡',
    label: '极简精练',
    hint: '剔除废话/直奔核心/高信噪比',
    directive: `STYLE DIRECTIVE — 极简精练：
只保留决定结果的信息。删掉客套、背景铺垫、重复表述与"请帮我/麻烦你"之类冗余。
目标是把提示词压到最短且不丢关键约束；宁短不长，能一句说完不用两句。`,
  },
  {
    id: 'custom',
    icon: '🛠',
    label: '自定义提示词',
    hint: '自由编辑专属优化逻辑',
    directive: '', // 由用户在设置里填
  },
]

const PRESET_IDS = new Set(PRESETS.map((p) => p.id))
const DEFAULT_PRESET = 'general'
const DEFAULT_CUSTOM_LABEL = '自定义提示词'

const DEFAULTS = {
  provider: '',
  model: '',
  maxChars: 800,
  timeoutMs: 60000,
}

// ── 设置读写（$DSH_HOME/storages/prompt-boost.json）───────────────
function settingsFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', 'prompt-boost.json')
}

function readSettings() {
  try {
    const raw = readFileSync(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      preset: PRESET_IDS.has(parsed?.preset) ? parsed.preset : DEFAULT_PRESET,
      customPrompt: typeof parsed?.customPrompt === 'string' ? parsed.customPrompt : '',
      customLabel:
        typeof parsed?.customLabel === 'string' && parsed.customLabel.trim()
          ? parsed.customLabel.trim().slice(0, 40)
          : DEFAULT_CUSTOM_LABEL,
    }
  } catch {
    return { preset: DEFAULT_PRESET, customPrompt: '', customLabel: DEFAULT_CUSTOM_LABEL }
  }
}

function writeSettings(next) {
  const file = settingsFile()
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, file) // 原子替换，避免半截文件
}

/**
 * 安全读取 DSH 服务：Cordis 里直接访问未声明 inject 的服务属性会抛
 * `cannot get property "x" without inject`，而 ctx.get() 是豁免的。
 */
function getSvc(ctx, serviceName) {
  if (!ctx || !serviceName) return undefined
  try {
    if (typeof ctx.get === 'function') {
      const value = ctx.get(serviceName)
      if (value !== undefined && value !== null) return value
    }
  } catch {
    /* 落到下一档 */
  }
  try {
    return ctx.reflect?.get?.(serviceName) ?? undefined
  } catch {
    return undefined
  }
}

/** 去掉模型偶尔包在外层的引号（与内置实现同款后处理）。 */
function stripWrappingQuotes(text) {
  return String(text || '')
    .trim()
    .replace(/^["'“”‘’]|["'“”‘’]$/g, '')
    .trim()
}

/** 把草稿包成 llm.stream 认识的 user message；拿不到 dsh-llm 时退回同形状普通对象。 */
async function makeUserMessage(text) {
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (typeof mod.createUserMessage === 'function') {
      return mod.createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'prompt-boost' },
      })
    }
  } catch {
    /* 链接安装时通常解析不到 dsh-llm，走下面的兜底 */
  }
  return {
    id: `prompt-boost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'prompt-boost' },
  }
}

/** 按预设拼出这次要用的 system prompt。 */
function systemPromptFor(presetId, customPrompt) {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0]
  if (preset.id === 'general' && !customPrompt) return BASE_SYSTEM_PROMPT
  const directive = preset.id === 'custom' ? String(customPrompt || '').trim() : preset.directive
  if (!directive) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}

STYLE DIRECTIVE (applies to the enhanced prompt you produce; never mention it in the output):
${directive}`
}

/**
 * 解析这次增强该用哪个 provider/model。
 * 全部失败时抛错，由路由转成 500 给前端显示。
 */
async function resolveRoute(ctx, cfg) {
  const llm = getSvc(ctx, 'llm')
  if (!llm || typeof llm.stream !== 'function') {
    throw new Error('DSH LLM 服务不可用（ctx.llm.stream 缺失）')
  }

  // 1) 显式配置
  if (cfg.provider && cfg.model) {
    return { provider: String(cfg.provider), model: String(cfg.model), llm }
  }

  // 2) DSH 系统设置里的默认模型
  try {
    const def = getSvc(ctx, 'agentDefaultModel')
    if (def && typeof def.currentSelection === 'function') {
      const sel = def.currentSelection()
      if (sel && sel.provider && sel.model) {
        return { provider: String(sel.provider), model: String(sel.model), llm }
      }
    }
  } catch {
    /* 继续往下找 */
  }

  // 3) 第一个能列出模型的 provider 的第一个模型
  const providers = typeof llm.listProviders === 'function' ? llm.listProviders() || [] : []
  for (const p of providers) {
    try {
      const models = (await llm.listModels(p.id)) || []
      if (models.length > 0) {
        return { provider: String(p.id), model: String(models[0].id), llm }
      }
    } catch {
      /* 试下一个 provider */
    }
  }

  throw new Error('DSH 里没有可用的模型：请先在 设置 → 模型 里配置一个提供商')
}

/** 走 DSH 自己的 LLM 层跑一次补全，凭证/代理/重试全由宿主负责。 */
async function enhance(ctx, cfg, text, presetId, customPrompt) {
  const { provider, model, llm } = await resolveRoute(ctx, cfg)
  const messages = [await makeUserMessage(USER_TEMPLATE.replace('{input}', text.slice(0, 6000)))]

  let raw = ''
  const stream = llm.stream({
    provider,
    model,
    messages,
    system: systemPromptFor(presetId, customPrompt),
    temperature: 0.3,
    maxTokens: 900,
    signal: AbortSignal.timeout(Number(cfg.timeoutMs) || DEFAULTS.timeoutMs),
    purpose: 'prompt-boost',
  })

  for await (const chunk of stream) {
    if ((chunk.type === 'text-delta' || chunk.type === 'text') && typeof chunk.text === 'string') {
      raw += chunk.text
    } else if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure?.message || 'LLM 调用失败')
    }
  }

  const out = stripWrappingQuotes(raw)
  if (!out) throw new Error('模型返回空内容')
  return {
    text: out.slice(0, Math.max(200, Number(cfg.maxChars) || 800)),
    provider,
    model,
    preset: presetId,
  }
}

/** 读请求体，限制大小，避免被打爆内存。 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Partial<typeof DEFAULTS>} [config]
 */
export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) }

  const handler = async (req, res) => {
    let pathname = '/'
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
    } catch {
      /* 畸形 URL 落到 404 */
    }

    // ── 设置：读 ────────────────────────────────────────────────
    if (pathname === '/api/prompt-boost/settings') {
      if (req.method === 'GET') {
        const settings = readSettings()
        sendJson(res, 200, {
          ok: true,
          ...settings,
          // 前端要"查看完整提示词"：给出基础部分 + 每个模板自己的可编辑内容
          baseSystemPrompt: BASE_SYSTEM_PROMPT,
          presets: PRESETS.map(({ id, icon, label, hint, directive }) => ({
            id,
            icon,
            // 自定义模板用用户起的名字，其余用内置标题
            label: id === 'custom' ? settings.customLabel : label,
            hint,
            directive: id === 'custom' ? settings.customPrompt : directive,
          })),
        })
        return
      }
      if (req.method === 'POST') {
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          const prev = readSettings()
          const next = {
            preset: PRESET_IDS.has(body.preset) ? body.preset : DEFAULT_PRESET,
            customPrompt:
              typeof body.customPrompt === 'string' ? body.customPrompt.slice(0, 8000) : prev.customPrompt,
            customLabel:
              typeof body.customLabel === 'string' && body.customLabel.trim()
                ? body.customLabel.trim().slice(0, 40)
                : prev.customLabel,
          }
          writeSettings(next)
          sendJson(res, 200, { ok: true, ...next })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      sendJson(res, 405, { ok: false, error: 'use GET or POST' })
      return
    }

    // ── 信息：这次会走哪个模型 / 哪个模板 ────────────────────────
    if (pathname === '/api/prompt-boost/info') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'use GET' })
        return
      }
      const { preset } = readSettings()
      try {
        const { provider, model } = await resolveRoute(ctx, cfg)
        sendJson(res, 200, { ok: true, provider, model, preset })
      } catch (error) {
        sendJson(res, 200, { ok: false, preset, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    // ── 增强 ────────────────────────────────────────────────────
    if (pathname !== '/api/prompt-boost/enhance') {
      sendJson(res, 404, { ok: false, error: 'unknown route' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'use POST' })
      return
    }

    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!text) {
        sendJson(res, 400, { ok: false, error: 'empty text' })
        return
      }
      const settings = readSettings()
      const presetId = PRESET_IDS.has(body.preset) ? body.preset : settings.preset
      if (presetId === 'custom' && !settings.customPrompt.trim()) {
        sendJson(res, 400, { ok: false, error: '自定义模板还是空的：请到 插件 → 增强提示词 里填写' })
        return
      }
      const result = await enhance(ctx, cfg, text, presetId, settings.customPrompt)
      sendJson(res, 200, { ok: true, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`[prompt-boost] enhance failed: ${message}`)
      sendJson(res, 500, { ok: false, error: message })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/api/prompt-boost', handler }),
    'prompt-boost: api routes',
  )
}
