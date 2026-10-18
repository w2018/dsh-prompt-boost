/**
 * 配置面板渲染/交互测试（jsdom + react-dom/client）
 *
 * 覆盖：下拉框选项、载入模板内容、切换模板 → 载入新内容 + 持久化、
 *      完整提示词预览、自定义模板名称输入框、空内容时保存禁用。
 *
 * 依赖不随插件安装（插件本身零运行时依赖），需要自备：
 *   mkdir /tmp/pb-test && cd /tmp/pb-test
 *   npm i react@18 react-dom@18 jsdom
 *   PB_TEST_DEPS=/tmp/pb-test/node_modules node test/panel.mjs
 *
 * 注：jsdom 里模拟 textarea 输入无法触发 React 的 onChange（合成事件依赖浏览器
 * 原生 value tracker 行为），所以"编辑 → 另存为"这条链由 test/smoke.mjs 在
 * Host 侧覆盖（POST /settings 的字段与落盘）。
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const depsRoot = process.env.PB_TEST_DEPS
if (!depsRoot || !existsSync(join(depsRoot, 'jsdom'))) {
  console.log('跳过：未提供 PB_TEST_DEPS（指向装了 react/react-dom/jsdom 的 node_modules）')
  process.exit(0)
}

const require = createRequire(join(depsRoot, 'noop.js'))
const { JSDOM } = require('jsdom')
const React = require('react')
const ReactDOMClient = require('react-dom/client')

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
})
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Event = dom.window.Event
dom.window.confirm = () => true

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))

// ── 假后端 ───────────────────────────────────────────────────
const PRESETS = [
  { id: 'general', icon: '🌟', label: '通用结构化', hint: '清晰目标/格式约束', directive: 'GENERAL 指令内容' },
  { id: 'code', icon: '💻', label: '编程与技术专家', hint: '架构设计', directive: 'CODE 指令内容' },
  { id: 'custom', icon: '🛠', label: '自定义提示词', hint: '自由编辑', directive: '' },
]
let store = { preset: 'general', customPrompt: '', customLabel: '自定义提示词' }
const posts = []

globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/settings') && init?.method !== 'POST') {
    return {
      ok: true,
      json: async () => ({
        ok: true,
        ...store,
        baseSystemPrompt: 'BASE_SYSTEM_PROMPT',
        presets: PRESETS.map((p) => ({
          ...p,
          directive: p.id === 'custom' ? store.customPrompt : p.directive,
          label: p.id === 'custom' ? store.customLabel : p.label,
        })),
      }),
    }
  }
  if (String(url).endsWith('/settings') && init?.method === 'POST') {
    const body = JSON.parse(init.body)
    posts.push(body)
    store = {
      preset: body.preset ?? store.preset,
      customPrompt: body.customPrompt ?? store.customPrompt,
      customLabel: body.customLabel ?? store.customLabel,
    }
    return { ok: true, json: async () => ({ ok: true, ...store }) }
  }
  return { ok: false, json: async () => ({ ok: false }) }
}

// ── 加载 bundle ──────────────────────────────────────────────
let captured = null
dom.window.__ModuleLoader__ = { load: (r) => { captured = r } }
await import(new URL('../client.js', import.meta.url).href)
const mod = captured.factory((name) => require(name))

const regs = []
mod.apply({
  get: (n) =>
    n === 'slots'
      ? {
          inject: (_n, fn) => fn(),
          register: (meta, comp) => {
            regs.push({ meta, comp })
            return () => {}
          },
        }
      : undefined,
})
const panel = regs.find((r) => r.meta.name === 'plugins.bundle.config').comp

const container = document.getElementById('root')
ReactDOMClient.createRoot(container).render(React.createElement(panel, {}))
await wait(150)

let failed = 0
const check = (name, cond, extra) => {
  console.log(`${cond ? '  ok ' : '  FAIL'} ${name}${extra === undefined ? '' : `  → ${extra}`}`)
  if (!cond) failed++
}
const $ = (sel) => container.querySelector(sel)
const $$ = (sel) => Array.from(container.querySelectorAll(sel))

// ① 下拉框
const select = $('select.pb-select')
check('有下拉框', Boolean(select))
check('选项数 = 3', $$('select.pb-select option').length === 3, $$('select.pb-select option').length)
check('当前值 = general', select.value === 'general', select.value)
check('选项文案含图标', $$('select.pb-select option')[1].textContent.includes('💻'))

// ② 载入内容
check('编辑器载入 general 内容', $('textarea.pb-area').value === 'GENERAL 指令内容', $('textarea.pb-area').value)
check('初始无「未保存」徽标', !container.textContent.includes('未保存的修改'))
check('初始保存按钮禁用（无改动）', $$('button.pb-save')[0].disabled === true)
check('显示当前生效模板徽标', container.textContent.includes('生效中：通用结构化'))

// ③ 切换模板 → 载入新内容 + 持久化
select.value = 'code'
select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
await wait(150)
check('切换后编辑器换成 code 内容', $('textarea.pb-area').value === 'CODE 指令内容', $('textarea.pb-area').value)
check('切换后 POST 了 preset=code', posts.some((p) => p.preset === 'code'))
check('切换后生效徽标更新', container.textContent.includes('生效中：编程与技术专家'))

// ④ 完整提示词预览
const toggle = $$('button.pb-link').find((b) => b.textContent.includes('查看完整系统提示词'))
check('有「查看完整系统提示词」入口', Boolean(toggle))
toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await wait(100)
const pre = $('pre.pb-pre')
check('展开完整提示词', Boolean(pre))
check('预览含基础提示词', pre?.textContent.includes('BASE_SYSTEM_PROMPT'))
check('预览含当前模板内容', pre?.textContent.includes('CODE 指令内容'))

// ⑤ 切到自定义 → 名称输入框 + 空内容禁用保存
const select2 = $('select.pb-select')
select2.value = 'custom'
select2.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
await wait(150)
check('自定义模板出现名称输入框', Boolean($('input.pb-input')))
check('自定义模板内容为空', $('textarea.pb-area').value === '')
check('空内容时保存按钮禁用', $$('button.pb-save')[0].disabled === true)

console.log(failed === 0 ? '\npanel OK' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
