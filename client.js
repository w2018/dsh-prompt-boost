/**
 * dsh-prompt-boost —— Client 半端（浏览器 bundle）
 *
 * 四个落点：
 *   1. `conversation.input.right`  → 输入框右下角、**模型选择器左侧**的 ✨ 按钮（order 越小越靠左）
 *   2. 输入框为空时整个按钮不渲染（useInput 订阅草稿，天然响应式）
 *   3. 优化成功后按钮变成「↩ 撤回」，点一下还原成原文（30 秒有效；手动改动草稿后自动失效）
 *   4. `plugins.bundle.config`     → 插件详情页里的模板配置面板（下拉框选模板 / 查看完整内容 / 编辑 / 另存为自定义）
 *
 * 模块 id 必须与 package.json 的 name 逐字一致 —— DSH 的客户端模块加载器
 * （@deepseek-ai/dsh-client-modules）按模块图里的 row.id 取这个 bundle。
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-boost',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef, useMemo } = React

    const PLUGIN_ID = 'dsh-prompt-boost'
    const SLOT_INPUT = 'conversation.input.right'
    const SLOT_BUNDLE_CONFIG = 'plugins.bundle.config'
    const API = '/api/prompt-boost'

    const UNDO_WINDOW_MS = 30000
    const DEFAULT_CUSTOM_LABEL = '自定义提示词'

    /** 样式必须带 data-plugin 归属标记，否则 DSH 的 claimStyles 会算到别的插件头上。 */
    function injectStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`)) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin', PLUGIN_ID)
      style.textContent = `
        .pb-btn {
          display: inline-flex; align-items: center; gap: 4px;
          height: 28px; padding: 0 8px; margin-right: 2px;
          border: 1px solid transparent; border-radius: 8px;
          background: transparent; color: inherit;
          font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
          opacity: 0.65; transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease;
        }
        .pb-btn:hover:not(:disabled) { opacity: 1; background: rgba(127,127,127,0.12); }
        .pb-btn:disabled { cursor: default; opacity: 0.45; }
        .pb-btn[data-state="error"] { color: #d9534f; opacity: 1; }
        .pb-btn[data-state="undo"] { opacity: 1; border-color: rgba(127,127,127,0.35); }
        .pb-btn[data-state="busy"] .pb-spark { animation: pb-pulse 900ms ease-in-out infinite; }
        @keyframes pb-pulse { 0%,100% { opacity: .3 } 50% { opacity: 1 } }

        .pb-panel { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
        .pb-panel-title { font-weight: 600; font-size: 13px; opacity: .9; }
        .pb-panel-desc { opacity: .6; font-size: 12px; line-height: 1.55; margin-top: -4px; }
        .pb-label { font-size: 12px; opacity: .75; }
        .pb-select {
          width: 100%; height: 32px; padding: 0 8px; box-sizing: border-box;
          border-radius: 8px; font: inherit; font-size: 13px; color: inherit;
          background: rgba(127,127,127,0.06); border: 1px solid rgba(127,127,127,0.28);
        }
        .pb-select:focus { outline: none; border-color: rgba(127,127,127,0.55); }
        .pb-badge {
          display: inline-flex; align-items: center; height: 18px; padding: 0 6px;
          border-radius: 5px; font-size: 11px; line-height: 1;
          background: rgba(127,127,127,0.16); opacity: .85;
        }
        .pb-badge[data-kind="dirty"] { color: #c77c00; background: rgba(199,124,0,0.14); }
        .pb-area {
          width: 100%; min-height: 120px; resize: vertical; box-sizing: border-box;
          padding: 8px 10px; border-radius: 8px; font: inherit; font-size: 12.5px; line-height: 1.6;
          color: inherit; background: rgba(127,127,127,0.06);
          border: 1px solid rgba(127,127,127,0.28);
        }
        .pb-area:focus { outline: none; border-color: rgba(127,127,127,0.55); }
        .pb-input {
          height: 30px; padding: 0 8px; box-sizing: border-box; flex: 1; min-width: 120px;
          border-radius: 8px; font: inherit; font-size: 12.5px; color: inherit;
          background: rgba(127,127,127,0.06); border: 1px solid rgba(127,127,127,0.28);
        }
        .pb-input:focus { outline: none; border-color: rgba(127,127,127,0.55); }
        .pb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .pb-save {
          height: 28px; padding: 0 12px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
          border: 1px solid rgba(127,127,127,0.4); background: transparent; color: inherit;
        }
        .pb-save:disabled { opacity: .45; cursor: default; }
        .pb-link {
          height: 24px; padding: 0 6px; border-radius: 6px; font-size: 12px; cursor: pointer;
          border: 1px solid transparent; background: transparent; color: inherit; opacity: .7;
        }
        .pb-link:hover { opacity: 1; background: rgba(127,127,127,0.12); }
        .pb-tip { font-size: 11.5px; opacity: .6; }
        .pb-tip[data-kind="error"] { color: #d9534f; opacity: 1; }
        .pb-tip[data-kind="ok"] { color: #2e9e5b; opacity: 1; }
        .pb-pre {
          margin: 0; padding: 10px; max-height: 260px; overflow: auto;
          border-radius: 8px; font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
          background: rgba(127,127,127,0.08); border: 1px solid rgba(127,127,127,0.2); opacity: .85;
        }
      `
      document.head.appendChild(style)
    }

    /** 四角星，纯 SVG 不引字体。 */
    function SparkIcon(props) {
      return h(
        'svg',
        {
          className: 'pb-spark',
          width: props?.size ?? 12,
          height: props?.size ?? 12,
          viewBox: '0 0 16 16',
          fill: 'currentColor',
          'aria-hidden': true,
        },
        h('path', { d: 'M8 1.2l1.45 3.9 3.9 1.45-3.9 1.45L8 11.9 6.55 8 2.65 6.55l3.9-1.45L8 1.2z' }),
        h('path', {
          d: 'M12.6 10.4l.62 1.66 1.66.62-1.66.62-.62 1.66-.62-1.66-1.66-.62 1.66-.62.62-1.66z',
          opacity: 0.75,
        }),
      )
    }

    function UndoIcon() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('path', { d: 'M3 8h7a3 3 0 1 1 0 6H7', strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M5.6 5.2L2.8 8l2.8 2.8', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /**
     * 输入框右侧控件（在模型选择器左侧）。
     * 插槽 props 提供 useInput（选择器 hook）与 inputActions.setDraft。
     */
    function BoostControl(props) {
      const { useInput, inputActions, sessionId } = props || {}

      const draft = typeof useInput === 'function'
        ? useInput((state) => (state && typeof state.draft === 'string' ? state.draft : ''))
        : ''
      const text = typeof draft === 'string' ? draft.trim() : ''
      const canWrite = Boolean(inputActions) && typeof inputActions.setDraft === 'function'

      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      /** { original, enhanced } —— 仅当草稿仍等于 enhanced 时有效 */
      const [undo, setUndo] = useState(null)
      const [route, setRoute] = useState('')
      const [preset, setPreset] = useState('')
      const timerRef = useRef(null)

      useEffect(() => {
        injectStyles()
        let alive = true
        fetch(`${API}/info`)
          .then((r) => r.json())
          .then((data) => {
            if (!alive || !data) return
            if (data.ok) setRoute(`${data.provider}/${data.model}`)
            if (data.preset) setPreset(data.preset)
          })
          .catch(() => {})
        return () => {
          alive = false
          if (timerRef.current) clearTimeout(timerRef.current)
        }
      }, [])

      // 用户手动改过草稿 → 撤回失效（避免把用户的编辑冲掉）
      useEffect(() => {
        if (undo && draft !== undo.enhanced) setUndo(null)
      }, [draft, undo])

      const flashError = useCallback((message) => {
        setErr(message)
        setTimeout(() => setErr(''), 4000)
      }, [])

      const runEnhance = useCallback(async () => {
        if (!text || busy || !canWrite) return
        setBusy(true)
        setErr('')
        try {
          const res = await fetch(`${API}/enhance`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
          setUndo({ original: text, enhanced: data.text })
          if (data.provider && data.model) setRoute(`${data.provider}/${data.model}`)
          if (data.preset) setPreset(data.preset)
          inputActions.setDraft(data.text)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
        } catch (error) {
          flashError(error instanceof Error ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }, [text, busy, canWrite, inputActions, flashError])

      const runUndo = useCallback(() => {
        if (!undo || !canWrite) return
        inputActions.setDraft(undo.original)
        setUndo(null)
        if (timerRef.current) clearTimeout(timerRef.current)
      }, [undo, canWrite, inputActions])

      // 输入框为空 → 入口整个隐藏
      if (!text) return null

      const state = busy ? 'busy' : err ? 'error' : undo ? 'undo' : 'idle'
      const title = err
        || (undo
          ? `已优化 · 点此还原为原文（${Math.round(UNDO_WINDOW_MS / 1000)} 秒内有效）`
          : route
            ? `用 DSH 已配置的 ${route} 改写当前输入${preset ? ` · 模板 ${preset}` : ''}`
            : '把当前输入改写成更清晰、可执行的提示词')

      if (state === 'undo') {
        return h(
          'button',
          { type: 'button', className: 'pb-btn', 'data-state': 'undo', title, onClick: runUndo },
          h(UndoIcon),
          h('span', null, '撤回'),
        )
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'pb-btn',
          'data-state': state,
          disabled: busy || !canWrite,
          title,
          onClick: runEnhance,
        },
        h(SparkIcon),
        h('span', null, busy ? '增强中' : err ? '失败' : '增强'),
      )
    }

    /** 取某个模板的可编辑内容（presets 里已按 id 归位）。 */
    function contentOf(list, id) {
      const found = (list || []).find((item) => item.id === id)
      return found ? found.directive || '' : ''
    }

    /**
     * 插件详情页里的模板配置面板（plugins.bundle.config）。
     *
     * 交互流程：
     *   下拉框选模板（= 切换当前生效模板，立即持久化）
     *     → 编辑器载入该模板的完整内容
     *     → 可编辑；改动后出现「未保存」徽标
     *     → 「保存为自定义模板」把当前内容另存为 custom 并切过去
     *     → 「恢复默认」丢弃改动，回到该模板的原始内容
     *     → 「查看完整系统提示词」展开 = 基础提示词 + 当前编辑内容（实时）
     */
    function SettingsPanel() {
      const [loading, setLoading] = useState(true)
      const [presets, setPresets] = useState([])
      const [baseSystemPrompt, setBaseSystemPrompt] = useState('')
      const [preset, setPreset] = useState('general')
      const [customLabel, setCustomLabel] = useState(DEFAULT_CUSTOM_LABEL)
      const [editor, setEditor] = useState('')
      const [baseline, setBaseline] = useState('')
      const [showFull, setShowFull] = useState(false)
      const [saving, setSaving] = useState(false)
      const [tip, setTip] = useState('')
      const [tipKind, setTipKind] = useState('ok')

      const dirty = editor !== baseline

      const byId = useMemo(() => {
        const map = {}
        for (const item of presets) map[item.id] = item
        return map
      }, [presets])

      // 只在挂载时拉一次：不能把 load 放进依赖，否则 setPresets 换了数组引用
      // 会再次触发 effect，把用户正在编辑的内容重置掉（甚至死循环）。
      useEffect(() => {
        injectStyles()
        let alive = true
        ;(async () => {
          try {
            const res = await fetch(`${API}/settings`)
            const data = await res.json()
            if (!alive) return
            if (!data || !data.ok) throw new Error(data?.error || '读取设置失败')
            const list = Array.isArray(data.presets) ? data.presets : []
            const activeId = data.preset || 'general'
            const content = contentOf(list, activeId)
            setPresets(list)
            setBaseSystemPrompt(data.baseSystemPrompt || '')
            setPreset(activeId)
            setCustomLabel(data.customLabel || DEFAULT_CUSTOM_LABEL)
            setEditor(content)
            setBaseline(content)
          } catch (error) {
            if (!alive) return
            setTipKind('error')
            setTip(error instanceof Error ? error.message : String(error))
          } finally {
            if (alive) setLoading(false)
          }
        })()
        return () => {
          alive = false
        }
      }, [])

      const flash = useCallback((message, kind = 'ok') => {
        setTipKind(kind)
        setTip(message)
        if (kind === 'ok') setTimeout(() => setTip(''), 2400)
      }, [])

      const persist = useCallback(async (payload) => {
        const res = await fetch(`${API}/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
        return data
      }, [])

      /** 下拉框切换：切换生效模板 + 载入它的内容。有未保存改动时先确认。 */
      const chooseTemplate = useCallback(
        async (id) => {
          if (id === preset && !dirty) return
          if (dirty && !window.confirm('当前模板有未保存的修改，切换会丢弃这些修改。继续？')) {
            return
          }
          const content = contentOf(presets, id)
          setPreset(id)
          setEditor(content)
          setBaseline(content)
          setShowFull(false)
          try {
            await persist({ preset: id, customPrompt: contentOf(presets, 'custom') })
            flash('已切换生效模板')
          } catch (error) {
            flash(error instanceof Error ? error.message : String(error), 'error')
          }
        },
        [preset, dirty, presets, persist, flash],
      )

      /** 另存为自定义模板：把编辑器内容写进 custom，并把当前生效模板切到 custom。 */
      const saveAsCustom = useCallback(async () => {
        if (!editor.trim()) {
          flash('模板内容不能为空', 'error')
          return
        }
        setSaving(true)
        try {
          const label = (customLabel || '').trim() || DEFAULT_CUSTOM_LABEL
          await persist({ preset: 'custom', customPrompt: editor, customLabel: label })
          setPreset('custom')
          setBaseline(editor)
          setCustomLabel(label)
          setPresets((prev) =>
            prev.map((item) =>
              item.id === 'custom' ? { ...item, directive: editor, label } : item,
            ),
          )
          flash('已保存为自定义模板，并设为当前生效')
        } catch (error) {
          flash(error instanceof Error ? error.message : String(error), 'error')
        } finally {
          setSaving(false)
        }
      }, [editor, customLabel, persist, flash])

      const resetEditor = useCallback(() => {
        setEditor(baseline)
        flash('已恢复为该模板的原始内容')
      }, [baseline, flash])

      if (loading) {
        return h('div', { className: 'pb-panel' }, h('div', { className: 'pb-panel-desc' }, '加载中…'))
      }

      const current = byId[preset]
      const fullPrompt = [baseSystemPrompt, editor.trim() ? `STYLE DIRECTIVE:\n${editor}` : '']
        .filter(Boolean)
        .join('\n\n')

      return h(
        'div',
        { className: 'pb-panel' },
        h('div', { className: 'pb-panel-title' }, '增强提示词 · 模板'),
        h(
          'div',
          { className: 'pb-panel-desc' },
          '下拉框选择模板 → 查看并编辑它的完整内容 → 需要保留改动就「保存为自定义模板」。',
        ),

        // ① 下拉框
        h(
          'div',
          null,
          h('div', { className: 'pb-label', style: { marginBottom: 4 } }, '当前生效模板'),
          h(
            'select',
            {
              className: 'pb-select',
              value: preset,
              onChange: (e) => chooseTemplate(e.target.value),
            },
            presets.map((item) =>
              h(
                'option',
                { key: item.id, value: item.id },
                `${item.icon || ''} ${item.label}${item.hint ? ` · ${item.hint}` : ''}`.trim(),
              ),
            ),
          ),
          h(
            'div',
            { className: 'pb-row', style: { marginTop: 6 } },
            h('span', { className: 'pb-badge' }, `生效中：${current ? current.label : preset}`),
            dirty ? h('span', { className: 'pb-badge', 'data-kind': 'dirty' }, '未保存的修改') : null,
          ),
        ),

        // ② 内容编辑器
        h(
          'div',
          null,
          h('div', { className: 'pb-label', style: { marginBottom: 4 } }, '模板内容（可编辑）'),
          h('textarea', {
            className: 'pb-area',
            value: editor,
            placeholder:
              '写下这个模板的改写规则，例如：\n- 一律补上验收标准\n- 必须给出一个反例\n- 保留我原有的技术栈，不要替换',
            onChange: (e) => setEditor(e.target.value),
          }),
          h(
            'div',
            { className: 'pb-panel-desc', style: { marginTop: 6 } },
            '这段内容会追加在内置基础提示词之后，点输入框的 ✨ 时生效。',
          ),
        ),

        // ③ 操作
        h(
          'div',
          { className: 'pb-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'pb-save',
              disabled: saving || !dirty || !editor.trim(),
              onClick: saveAsCustom,
            },
            saving ? '保存中…' : '保存为自定义模板',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'pb-link',
              disabled: !dirty,
              onClick: resetEditor,
            },
            '恢复默认',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'pb-link',
              onClick: () => setShowFull((v) => !v),
            },
            showFull ? '收起完整提示词' : '查看完整系统提示词',
          ),
        ),

        // ④ 自定义模板名称（仅自定义时可见）
        preset === 'custom'
          ? h(
              'div',
              { className: 'pb-row' },
              h('span', { className: 'pb-label' }, '模板名称'),
              h('input', {
                className: 'pb-input',
                value: customLabel,
                maxLength: 40,
                placeholder: DEFAULT_CUSTOM_LABEL,
                onChange: (e) => setCustomLabel(e.target.value),
                onBlur: async () => {
                  const label = (customLabel || '').trim() || DEFAULT_CUSTOM_LABEL
                  if (label === (byId.custom?.label || '')) return
                  try {
                    await persist({
                      preset: 'custom',
                      customPrompt: editor,
                      customLabel: label,
                    })
                    setCustomLabel(label)
                    setPresets((prev) =>
                      prev.map((item) => (item.id === 'custom' ? { ...item, label } : item)),
                    )
                    flash('模板名称已更新')
                  } catch (error) {
                    flash(error instanceof Error ? error.message : String(error), 'error')
                  }
                },
              }),
            )
          : null,

        h('div', { className: 'pb-tip', 'data-kind': tipKind }, tip),

        // ⑤ 完整提示词预览（基础 + 当前编辑内容，实时）
        showFull
          ? h(
              'div',
              null,
              h(
                'div',
                { className: 'pb-panel-desc', style: { marginBottom: 6 } },
                '下面是这次点 ✨ 时真正发给模型的 system prompt（基础部分 + 你的模板，含未保存的修改）。',
              ),
              h('pre', { className: 'pb-pre' }, fullPrompt),
            )
          : null,

        h(
          'div',
          { className: 'pb-panel-desc' },
          '模型与凭证直接复用 DSH 系统设置里已配置的那份，无需在此填写 API Key。',
        ),
      )
    }

    const inject = ['slots', 'sessions']

    function apply(ctx) {
      injectStyles()
      const slots = ctx.get('slots')
      if (!slots) {
        console.warn('[prompt-boost] slots service unavailable, UI skipped')
        return
      }

      // 输入框右侧工具条：order 越小越靠左 → 落在模型选择器左侧
      slots.inject(SLOT_INPUT, () =>
        slots.register({ name: SLOT_INPUT, id: PLUGIN_ID, order: -10, label: '增强提示词' }, BoostControl),
      )

      // 插件详情页的配置面板
      slots.inject(SLOT_BUNDLE_CONFIG, () =>
        slots.register({ name: SLOT_BUNDLE_CONFIG, key: PLUGIN_ID, priority: 30 }, SettingsPanel),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
