// 在 profile 的解析环境下验证两半端能否被加载（不启动 DSH）
import { readFileSync } from 'node:fs'

const host = await import('dsh-prompt-boost')
console.log('host exports:', Object.keys(host).join(', '))
console.log('host name   :', host.name, '| inject:', JSON.stringify(host.inject))
if (typeof host.apply !== 'function') throw new Error('host apply 缺失')

// 模拟浏览器：拦截 __ModuleLoader__.load
const captured = []
globalThis.window = {
  __ModuleLoader__: {
    load(reg) {
      captured.push(reg)
    },
  },
}
globalThis.document = undefined

await import('dsh-prompt-boost/client')
if (captured.length !== 1) throw new Error(`期望 1 次 load，实际 ${captured.length}`)
const reg = captured[0]
console.log('client id   :', reg.id)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (reg.id !== pkg.name) throw new Error(`client id 与包名不一致: ${reg.id} vs ${pkg.name}`)

const mod = reg.factory(() => ({ createElement: () => null, useState: () => [null, () => {}] }))
console.log('client apply:', typeof mod.apply, '| inject:', JSON.stringify(mod.inject))
if (typeof mod.apply !== 'function') throw new Error('client apply 缺失')
console.log('load OK')
