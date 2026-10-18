/**
 * Host 半端冒烟测试：不启动 DSH，用假的 ctx 走一遍全部路由。
 *   node test/smoke.mjs "帮我做个报表"
 *
 * 假 ctx 只实现本插件真正用到的东西：
 *   ctx.webServer.register / ctx.effect / ctx.logger
 *   ctx.get('llm')               → { stream, listProviders, listModels }
 *   ctx.get('agentDefaultModel') → { currentSelection }
 *
 * 设置文件写到项目内的临时 DSH_HOME，不碰真实 ~/.dsh。
 */
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpHome = mkdtempSync(join(tmpdir(), 'pb-smoke-'))
process.env.DSH_HOME = tmpHome

const { apply } = await import('../index.js')

const text = process.argv[2] || '帮我做个报表'

const routes = []
let seenOptions = null

const llm = {
  listProviders: () => [{ id: 'deepseek-official' }],
  listModels: async (id) => (id === 'deepseek-official' ? [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] : []),
  async *stream(options) {
    seenOptions = options
    for (const piece of ['请帮我制作一份', '数据报表，明确主题、', '数据来源与输出格式。']) {
      yield { type: 'text-delta', text: piece }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const services = {
  llm,
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) },
}

const ctx = {
  logger: { warn: (m) => console.warn(m) },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect(fn) {
    fn()
  },
  get: (name) => services[name],
}

apply(ctx, {})
if (routes.length !== 1) throw new Error(`期望注册 1 条路由，实际 ${routes.length}`)

const handler = routes[0].handler

function fakeReq(body, method = 'POST', url = '/api/prompt-boost/enhance') {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from(payload ? [Buffer.from(payload)] : [])
  req.method = method
  req.url = url
  return req
}

function fakeRes() {
  return {
    status: 0,
    payload: undefined,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.payload = body ? JSON.parse(body) : undefined
    },
  }
}

async function call(body, method, url) {
  const res = fakeRes()
  await handler(fakeReq(body, method, url), res)
  return res
}

let failed = 0
const check = (name, cond, extra) => {
  console.log(`${cond ? '  ok ' : '  FAIL'} ${name}${extra === undefined ? '' : `  → ${extra}`}`)
  if (!cond) failed++
}

// 1) 默认预设（general）增强
const r1 = await call({ text })
check('enhance 200', r1.status === 200, r1.payload?.error)
check('路由来自 agentDefaultModel', r1.payload?.provider === 'deepseek-official' && r1.payload?.model === 'deepseek-flash')
check('默认预设 = general', r1.payload?.preset === 'general', r1.payload?.preset)
check('general 不加 STYLE DIRECTIVE', !String(seenOptions?.system).includes('STYLE DIRECTIVE'))
console.log('     结果:', r1.payload?.text)

// 2) 设置：读
const r2 = await call(undefined, 'GET', '/api/prompt-boost/settings')
check('settings GET 200', r2.status === 200)
check('预设共 6 个', r2.payload?.presets?.length === 6, r2.payload?.presets?.length)
check('默认 preset 字段', r2.payload?.preset === 'general', r2.payload?.preset)
check('带回基础提示词', String(r2.payload?.baseSystemPrompt).includes('Prompt Engineering Expert'))
const codePreset = r2.payload?.presets?.find((p) => p.id === 'code')
check('预设带回完整 directive', String(codePreset?.directive).includes('编程与技术专家'))
check('自定义模板带默认名称', r2.payload?.customLabel === '自定义提示词', r2.payload?.customLabel)
const customPreset = r2.payload?.presets?.find((p) => p.id === 'custom')
check('custom 条目初始为空内容', customPreset?.directive === '', JSON.stringify(customPreset?.directive))

// 3) 设置：写 code
const r3 = await call({ preset: 'code' }, 'POST', '/api/prompt-boost/settings')
check('settings POST 200', r3.status === 200 && r3.payload?.preset === 'code')

// 4) 用 code 预设增强 → system 应带风格指令
const r4 = await call({ text })
check('code 预设生效', r4.payload?.preset === 'code', r4.payload?.preset)
check('system 含 STYLE DIRECTIVE', String(seenOptions?.system).includes('STYLE DIRECTIVE'))
check('system 含编程关键词', String(seenOptions?.system).includes('编程与技术专家'))

// 5) 切到 custom 但没填内容 → 400
await call({ preset: 'custom' }, 'POST', '/api/prompt-boost/settings')
const r5 = await call({ text })
check('空自定义模板被拦', r5.status === 400, r5.payload?.error)

// 6) 填上自定义内容后可用
await call({ preset: 'custom', customPrompt: '一律补上验收标准。', customLabel: '我的规范' }, 'POST', '/api/prompt-boost/settings')
const r6 = await call({ text })
check('自定义模板生效', r6.status === 200 && String(seenOptions?.system).includes('一律补上验收标准'))
const r6b = await call(undefined, 'GET', '/api/prompt-boost/settings')
check('自定义名称已保存', r6b.payload?.customLabel === '我的规范', r6b.payload?.customLabel)
const customAfter = r6b.payload?.presets?.find((p) => p.id === 'custom')
check('custom 条目内容已更新', customAfter?.directive === '一律补上验收标准。')
check('custom 条目名称已更新', customAfter?.label === '我的规范', customAfter?.label)
check('其它预设未被覆盖', String(r6b.payload?.presets?.find((p) => p.id === 'code')?.directive).includes('编程与技术专家'))

// 7) 空输入 / 未知路由 / 方法不对
check('空输入 400', (await call({ text: '  ' })).status === 400)
check('未知子路径 404', (await call({ text }, 'POST', '/api/prompt-boost/nope')).status === 404)
check('GET enhance 405', (await call({}, 'GET', '/api/prompt-boost/enhance')).status === 405)

// 8) info
const r8 = await call(undefined, 'GET', '/api/prompt-boost/info')
check('info 200', r8.status === 200 && r8.payload?.model === 'deepseek-flash')

rmSync(tmpHome, { recursive: true, force: true })
console.log(failed === 0 ? '\nsmoke OK' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
