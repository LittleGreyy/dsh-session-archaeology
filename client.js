/**
 * Session Archaeology — Client half.
 *
 * A sidebar entry plus the central page it addresses. The page lists historical
 * sessions, asks the Host to distil one on demand, lets the draft be edited, and
 * saves it into the skill library. Nothing runs until the user clicks.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-archaeology',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const NS = 'session-archaeology'
    const PANEL = 'session-archaeology'
    const API = '/session-archaeology'

    let host = null

    const zh = {
      'nav.label': '会话考古',
      'page.title': '会话考古',
      'page.subtitle': '选中一段历史会话，离线蒸馏成可复用的 Skill。不调用模型，只读已提交的日志。',
      'head.badge': '{count} 个技能',
      'search.placeholder': '筛选会话',
      'list.loading': '正在读取会话…',
      'list.empty': '没有匹配的会话',
      'empty.title': '从左侧挑一段会话开始',
      'empty.hint': '蒸馏只做一件事：把那次会话里真正跑通的步骤、踩过的坑和最后的验证，整理成一份可复用的操作记录。',
      'empty.p1': '命令与文件改动',
      'empty.p2': '失败与修正',
      'empty.p3': '事件级证据',
      'hero.created': '创建',
      'hero.workspace': '工作区',
      'hero.session': '会话 ID',
      'session.live': '进行中',
      'cta.digest': '蒸馏 Skill',
      'cta.busy': '蒸馏中…',
      'cta.again': '重新蒸馏',
      'cta.offline': '离线规则蒸馏 · 零模型调用',
      'stat.calls': '工具调用',
      'stat.commands': '命令',
      'stat.failures': '失败',
      'stat.files': '文件',
      'stat.events': '事件',
      'form.name': '技能名称',
      'form.nameHint': '小写字母、数字与连字符，保存后在技能目录里以此名出现',
      'form.description': '描述',
      'form.when': '何时使用',
      'doc.title': 'SKILL.md',
      'doc.preview': '预览',
      'doc.source': '源文件',
      'doc.hint': '保存时按此内容写入',
      'doc.chars': '{count} 字符',
      'save.run': '保存到技能库',
      'save.busy': '保存中…',
      'save.overwrite': '覆盖同名技能',
      'save.ok': '已保存',
      'lib.title': '已蒸馏技能',
      'lib.empty': '库里还没有技能。蒸馏一份，它就会出现在所有会话的技能目录中。',
      'lib.delete': '删除',
      'lib.confirm': '确认删除',
      'lib.dir': '技能目录',
      'copy.done': '已复制',
      'copy.dir': '复制目录',
      'error.generic': '操作失败',
      'time.justNow': '刚刚',
      'time.minutes': '{count} 分钟前',
      'time.hours': '{count} 小时前',
      'time.days': '{count} 天前',
    }

    const en = {
      'nav.label': 'Session Archaeology',
      'page.title': 'Session Archaeology',
      'page.subtitle': 'Pick a historical session by hand and distil it into a reusable Skill. No model calls — only committed logs.',
      'head.badge': '{count} skills',
      'search.placeholder': 'Filter sessions',
      'list.loading': 'Reading sessions…',
      'list.empty': 'No matching session',
      'empty.title': 'Pick a session on the left',
      'empty.hint': 'Distillation does one thing: turn what actually worked — steps, pitfalls, final checks — into a reusable record.',
      'empty.p1': 'commands and file edits',
      'empty.p2': 'failures and fixes',
      'empty.p3': 'event-level evidence',
      'hero.created': 'Created',
      'hero.workspace': 'Workspace',
      'hero.session': 'Session ID',
      'session.live': 'live',
      'cta.digest': 'Distil Skill',
      'cta.busy': 'Distilling…',
      'cta.again': 'Distil again',
      'cta.offline': 'Offline rule-based distillation · zero model calls',
      'stat.calls': 'calls',
      'stat.commands': 'commands',
      'stat.failures': 'failures',
      'stat.files': 'files',
      'stat.events': 'events',
      'form.name': 'Skill name',
      'form.nameHint': 'lowercase letters, digits and dashes — this is how it appears in the skill catalog',
      'form.description': 'Description',
      'form.when': 'When to use',
      'doc.title': 'SKILL.md',
      'doc.preview': 'Preview',
      'doc.source': 'Source',
      'doc.hint': 'written verbatim on save',
      'doc.chars': '{count} chars',
      'save.run': 'Save to skill library',
      'save.busy': 'Saving…',
      'save.overwrite': 'Overwrite same-name skill',
      'save.ok': 'Saved',
      'lib.title': 'Distilled skills',
      'lib.empty': 'The library is empty. Distil one and it joins the skill catalog of every session.',
      'lib.delete': 'Delete',
      'lib.confirm': 'Confirm delete',
      'lib.dir': 'Skill directory',
      'copy.done': 'Copied',
      'copy.dir': 'Copy path',
      'error.generic': 'Operation failed',
      'time.justNow': 'just now',
      'time.minutes': '{count}m ago',
      'time.hours': '{count}h ago',
      'time.days': '{count}d ago',
    }

    function substitute(text, params) {
      if (!params) return text
      let out = text
      for (const key of Object.keys(params)) out = out.split(`{${key}}`).join(String(params[key]))
      return out
    }

    function useT() {
      const [, bump] = useState(0)
      useEffect(() => {
        if (!host) return undefined
        const unsubscribe = host.locale.subscribe(() => bump((n) => n + 1))
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [])
      return useCallback((key, params) => {
        let text
        try {
          text = host ? host.locale.bind(NS)(key, params) : undefined
        } catch {
          text = undefined
        }
        if (typeof text !== 'string' || text === key) {
          const locale = host ? host.locale.getLocale() : undefined
          const id = String(locale?.id ?? locale?.locale ?? 'zh')
          const dict = id.toLowerCase().startsWith('zh') ? zh : en
          text = dict[key] ?? key
        }
        return substitute(text, params)
      }, [])
    }

    const pad = (value) => String(value).padStart(2, '0')

    function formatDate(value) {
      const time = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
      if (!Number.isFinite(time) || time <= 0) return '—'
      const date = new Date(time)
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function relativeTime(t, value) {
      const time = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
      if (!Number.isFinite(time) || time <= 0) return '—'
      const diff = Date.now() - time
      if (diff < 60_000) return t('time.justNow')
      if (diff < 3_600_000) return t('time.minutes', { count: Math.floor(diff / 60_000) })
      if (diff < 86_400_000) return t('time.hours', { count: Math.floor(diff / 3_600_000) })
      if (diff < 7 * 86_400_000) return t('time.days', { count: Math.floor(diff / 86_400_000) })
      return formatDate(time).slice(0, 10)
    }

    async function request(path, init) {
      const response = await fetch(`${API}${path}`, init)
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok) {
        const error = new Error(body?.message || body?.error || `HTTP ${response.status}`)
        error.status = response.status
        error.body = body
        throw error
      }
      return body
    }

    const jsonPost = (path, payload) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload ?? {}),
      })

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    }

    // ---------------------------------------------------------------- icons

    /** The sidebar glyph: sediment below, one distilled spark above. */
    function NavIcon(props) {
      const size = props?.size ?? 18
      const active = Boolean(props?.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.82 },
        },
        h('path', {
          key: 'star',
          d: 'M12 3.1 13.5 6.7 17.1 8.2 13.5 9.7 12 13.3 10.5 9.7 6.9 8.2 10.5 6.7Z',
          fill: 'currentColor',
        }),
        h('path', {
          key: 'a',
          d: 'M3.6 15.6c2.7-1.9 5.1-1.9 7.8 0s5.1 1.9 7.8 0 1.6-0.9 2.4-0.6',
          stroke: 'currentColor',
          strokeWidth: 1.45,
          strokeLinecap: 'round',
          opacity: 0.6,
        }),
        h('path', {
          key: 'b',
          d: 'M3.6 19.6c2.7-1.9 5.1-1.9 7.8 0s5.1 1.9 7.8 0 1.6-0.9 2.4-0.6',
          stroke: 'currentColor',
          strokeWidth: 1.45,
          strokeLinecap: 'round',
          opacity: 0.35,
        }),
      )
    }

    function SparkIcon({ size = 13 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 2.2 9.25 5.5 12.6 6.8 9.25 8.1 8 11.4 6.75 8.1 3.4 6.8 6.75 5.5Z',
          fill: 'currentColor',
        }),
      )
    }

    function CopyIcon({ size = 12 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { key: 'a', x: 5.5, y: 5.5, width: 7.5, height: 7.5, rx: 1.6 }),
        h('path', { key: 'b', d: 'M10.5 3.2H4.2c-.6 0-1 .4-1 1v6.3' }),
      )
    }

    function SearchIcon({ size = 13 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('circle', { key: 'a', cx: 7, cy: 7, r: 4.1 }),
        h('path', { key: 'b', d: 'M10.2 10.2 13.4 13.4' }),
      )
    }

    // ------------------------------------------------------------ rendering

    function renderInline(text, prefix) {
      const parts = String(text ?? '').split(/(`[^`]*`)/g)
      return parts.map((part, index) => {
        const key = `${prefix}-${index}`
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return h('code', { key, className: 'sa-code' }, part.slice(1, -1))
        }
        return part
      })
    }

    /** A deliberately small Markdown reader for the shape this plugin writes. */
    function renderDoc(markdown) {
      const nodes = []
      let list = null
      const flush = () => {
        if (!list) return
        const items = list.items
        nodes.push(
          h(
            list.kind,
            { key: `list-${nodes.length}`, className: 'sa-doc-list' },
            items.map((item, index) => h('li', { key: index }, renderInline(item, `li-${nodes.length}-${index}`))),
          ),
        )
        list = null
      }

      String(markdown ?? '')
        .split(/\r?\n/)
        .forEach((line, index) => {
          const key = `l-${index}`
          if (!line.trim()) {
            flush()
            return
          }
          if (line.startsWith('## ')) {
            flush()
            nodes.push(h('h2', { key, className: 'sa-doc-h2' }, renderInline(line.slice(3), key)))
            return
          }
          if (line.startsWith('# ')) {
            flush()
            nodes.push(h('h1', { key, className: 'sa-doc-h1' }, renderInline(line.slice(2), key)))
            return
          }
          if (line.startsWith('> ')) {
            flush()
            nodes.push(h('p', { key, className: 'sa-doc-quote' }, renderInline(line.slice(2), key)))
            return
          }
          const ordered = /^(\d+)\.\s+(.*)$/.exec(line)
          if (ordered) {
            if (!list || list.kind !== 'ol') {
              flush()
              list = { kind: 'ol', items: [] }
            }
            list.items.push(ordered[2])
            return
          }
          if (/^[-*]\s+/.test(line)) {
            if (!list || list.kind !== 'ul') {
              flush()
              list = { kind: 'ul', items: [] }
            }
            list.items.push(line.replace(/^[-*]\s+/, ''))
            return
          }
          if (list && /^\s{2,}\S/.test(line)) {
            list.items[list.items.length - 1] += ` ${line.trim()}`
            return
          }
          flush()
          nodes.push(h('p', { key, className: 'sa-doc-p' }, renderInline(line, key)))
        })
      flush()
      return nodes
    }

    function StatStrip({ stats, t }) {
      if (!stats) return null
      const cells = [
        ['stat.calls', stats.toolCalls],
        ['stat.commands', stats.commands],
        ['stat.failures', stats.failures],
        ['stat.files', stats.distinctFiles],
        ['stat.events', stats.events],
      ]
      return h(
        'div',
        { className: 'sa-stats' },
        cells.map(([key, value]) =>
          h(
            'div',
            { className: 'sa-stat', key },
            h('span', { className: 'sa-stat-num' }, typeof value === 'number' ? value : '—'),
            h('span', { className: 'sa-stat-label' }, t(key)),
          ),
        ),
      )
    }

    function DocView({ draft, name, description, whenToUse, t }) {
      const [tab, setTab] = useState('preview')
      const source = useMemo(
        () =>
          [
            '---',
            `name: ${name.trim() || draft.name}`,
            `description: ${JSON.stringify(description.trim())}`,
            `when-to-use: ${JSON.stringify(whenToUse.trim())}`,
            `source-session: ${JSON.stringify(draft.sessionId ?? '')}`,
            '---',
            '',
            draft.body ?? '',
          ].join('\n'),
        [draft, name, description, whenToUse],
      )
      const rendered = useMemo(() => renderDoc(draft.body ?? ''), [draft.body])
      return h(
        'section',
        { className: 'sa-doc' },
        h(
          'div',
          { className: 'sa-doc-head' },
          h(
            'div',
            { className: 'sa-doc-title' },
            h(SparkIcon, { size: 12 }),
            h('span', null, t('doc.title')),
            h('span', { className: 'sa-doc-hint' }, t('doc.hint')),
          ),
          h(
            'div',
            { className: 'sa-tabs', role: 'tablist' },
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                className: tab === 'preview' ? 'sa-tab is-on' : 'sa-tab',
                'aria-selected': tab === 'preview',
                onClick: () => setTab('preview'),
              },
              t('doc.preview'),
            ),
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                className: tab === 'source' ? 'sa-tab is-on' : 'sa-tab',
                'aria-selected': tab === 'source',
                onClick: () => setTab('source'),
              },
              t('doc.source'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'sa-doc-body' },
          tab === 'preview' ? rendered : h('pre', { className: 'sa-pre' }, source),
        ),
      )
    }

    function Library({ skills, skillsDir, copied, onCopy, onDelete, pendingDelete, t }) {
      return h(
        'section',
        { className: 'sa-lib' },
        h(
          'div',
          { className: 'sa-lib-head' },
          h('span', { className: 'sa-section-title' }, t('lib.title')),
          skillsDir
            ? h(
                'button',
                { type: 'button', className: 'sa-mini', onClick: () => onCopy(skillsDir) },
                h(CopyIcon, { size: 11 }),
                h('span', null, copied ? t('copy.done') : t('copy.dir')),
              )
            : null,
        ),
        skills.length === 0
          ? h('p', { className: 'sa-lib-empty' }, t('lib.empty'))
          : skills.map((skill) =>
              h(
                'article',
                { className: 'sa-skill', key: skill.name },
                h('div', { className: 'sa-monogram' }, skill.name.slice(0, 2).toUpperCase()),
                h(
                  'div',
                  { className: 'sa-skill-main' },
                  h('div', { className: 'sa-skill-name' }, skill.name),
                  h('p', { className: 'sa-skill-desc' }, skill.description || '—'),
                  h(
                    'div',
                    { className: 'sa-skill-meta' },
                    h('span', null, skill.sessionTitle || skill.sourceSession || '—'),
                    h('span', { className: 'sa-sep' }, '·'),
                    h('span', null, relativeTime(t, skill.distilledAt)),
                    h('span', { className: 'sa-sep' }, '·'),
                    h('code', { className: 'sa-skill-path', title: skill.file }, skill.file),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: pendingDelete === skill.name ? 'sa-mini sa-mini-danger' : 'sa-mini',
                    onClick: () => onDelete(skill.name),
                  },
                  pendingDelete === skill.name ? t('lib.confirm') : t('lib.delete'),
                ),
              ),
            ),
      )
    }

    function EmptyState({ t }) {
      return h(
        'div',
        { className: 'sa-empty' },
        h('div', { className: 'sa-empty-glyph' }, h(NavIcon, { size: 34, active: true })),
        h('div', { className: 'sa-empty-title' }, t('empty.title')),
        h('p', { className: 'sa-empty-hint' }, t('empty.hint')),
        h(
          'div',
          { className: 'sa-empty-points' },
          [t('empty.p1'), t('empty.p2'), t('empty.p3')].map((text) =>
            h('span', { className: 'sa-point', key: text }, h('span', { className: 'sa-point-dot' }), text),
          ),
        ),
      )
    }

    function Hero({ session, busy, hasDraft, onDigest, t }) {
      return h(
        'section',
        { className: 'sa-hero' },
        h(
          'div',
          { className: 'sa-hero-head' },
          h(
            'div',
            { className: 'sa-hero-title-wrap' },
            h('h1', { className: 'sa-hero-title' }, session.title || session.id),
            h(
              'div',
              { className: 'sa-hero-sub' },
              session.live ? h('span', { className: 'sa-live' }, h('span', { className: 'sa-live-dot' }), t('session.live')) : null,
              h('span', null, relativeTime(t, session.createdAt)),
              session.workspace ? h('span', { className: 'sa-sep' }, '·') : null,
              session.workspace ? h('span', null, session.workspace) : null,
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sa-btn sa-btn-primary',
              disabled: busy,
              onClick: onDigest,
            },
            h(SparkIcon, { size: 12 }),
            h('span', null, busy ? t('cta.busy') : hasDraft ? t('cta.again') : t('cta.digest')),
          ),
        ),
        h(
          'div',
          { className: 'sa-meta-grid' },
          h(
            'div',
            { className: 'sa-meta-item' },
            h('span', { className: 'sa-meta-key' }, t('hero.created')),
            h('span', { className: 'sa-meta-value' }, formatDate(session.createdAt)),
          ),
          h(
            'div',
            { className: 'sa-meta-item' },
            h('span', { className: 'sa-meta-key' }, t('hero.workspace')),
            h('span', { className: 'sa-meta-value' }, session.workspace || '—'),
          ),
          h(
            'div',
            { className: 'sa-meta-item sa-meta-wide' },
            h('span', { className: 'sa-meta-key' }, t('hero.session')),
            h('span', { className: 'sa-meta-value sa-mono' }, session.id),
          ),
        ),
        h('div', { className: 'sa-offline' }, h(SparkIcon, { size: 11 }), h('span', null, t('cta.offline'))),
      )
    }

    function Page() {
      const t = useT()
      const [sessions, setSessions] = useState([])
      const [skills, setSkills] = useState([])
      const [skillsDir, setSkillsDir] = useState('')
      const [query, setQuery] = useState('')
      const [selectedId, setSelectedId] = useState('')
      const [loadingSessions, setLoadingSessions] = useState(true)
      const [digesting, setDigesting] = useState(false)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [draft, setDraft] = useState(null)
      const [name, setName] = useState('')
      const [description, setDescription] = useState('')
      const [whenToUse, setWhenToUse] = useState('')
      const [conflict, setConflict] = useState(false)
      const [pendingDelete, setPendingDelete] = useState('')
      const [copied, setCopied] = useState(false)
      const copyTimer = useRef(null)

      useEffect(() => () => clearTimeout(copyTimer.current), [])

      const loadSessions = useCallback(async () => {
        setLoadingSessions(true)
        try {
          const data = await request('/sessions')
          setSessions(Array.isArray(data?.sessions) ? data.sessions : [])
          if (data?.skillsDir) setSkillsDir(String(data.skillsDir))
          setError('')
        } catch (loadError) {
          setError(`${t('error.generic')}: ${loadError.message}`)
        } finally {
          setLoadingSessions(false)
        }
      }, [t])

      const loadSkills = useCallback(async () => {
        try {
          const data = await request('/skills')
          setSkills(Array.isArray(data?.skills) ? data.skills : [])
          if (data?.skillsDir) setSkillsDir(String(data.skillsDir))
        } catch {
          setSkills([])
        }
      }, [])

      useEffect(() => {
        loadSessions()
        loadSkills()
      }, [loadSessions, loadSkills])

      const selected = useMemo(
        () => sessions.find((session) => session.id === selectedId) ?? null,
        [sessions, selectedId],
      )

      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return sessions
        return sessions.filter((session) =>
          `${session.title} ${session.id} ${session.workspace}`.toLowerCase().includes(needle),
        )
      }, [sessions, query])

      const copy = async (text) => {
        const ok = await copyText(text)
        if (!ok) return
        setCopied(true)
        clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 1600)
      }

      const pick = (session) => {
        setSelectedId(session.id)
        setDraft(null)
        setError('')
        setNotice('')
        setConflict(false)
        setPendingDelete('')
      }

      const runDigest = async () => {
        if (!selected) return
        setDigesting(true)
        setError('')
        setNotice('')
        setConflict(false)
        try {
          const data = await jsonPost('/digest', { sessionId: selected.id })
          const next = data?.draft
          if (!next) throw new Error('empty digest')
          setDraft(next)
          setName(next.name ?? '')
          setDescription(next.description ?? '')
          setWhenToUse(next.whenToUse ?? '')
        } catch (digestError) {
          setError(`${t('error.generic')}: ${digestError.message}`)
        } finally {
          setDigesting(false)
        }
      }

      const save = async (overwrite) => {
        if (!draft) return
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const data = await jsonPost('/save', {
            overwrite: overwrite === true,
            draft: {
              ...draft,
              name: name.trim(),
              description: description.trim(),
              whenToUse: whenToUse.trim(),
            },
          })
          setConflict(false)
          setNotice(data?.file ?? '')
          await loadSkills()
        } catch (saveError) {
          if (saveError.status === 409) {
            setConflict(true)
            setError(t('save.exists'))
          } else {
            setError(`${t('error.generic')}: ${saveError.message}`)
          }
        } finally {
          setSaving(false)
        }
      }

      const removeSkill = async (skillName) => {
        if (pendingDelete !== skillName) {
          setPendingDelete(skillName)
          return
        }
        setPendingDelete('')
        try {
          await jsonPost('/delete', { name: skillName })
          await loadSkills()
        } catch (deleteError) {
          setError(`${t('error.generic')}: ${deleteError.message}`)
        }
      }

      return h(
        'div',
        { className: 'sa-root' },
        h('style', { key: 'css' }, CSS),
        h(
          'header',
          { className: 'sa-head' },
          h('div', { className: 'sa-mark' }, h(NavIcon, { size: 19, active: true })),
          h(
            'div',
            { className: 'sa-head-text' },
            h('div', { className: 'sa-title' }, t('page.title')),
            h('div', { className: 'sa-sub' }, t('page.subtitle')),
          ),
          h(
            'div',
            { className: 'sa-head-meta' },
            h('span', { className: 'sa-badge' }, h(SparkIcon, { size: 10 }), t('head.badge', { count: skills.length })),
          ),
        ),
        h(
          'div',
          { className: 'sa-body' },
          h(
            'aside',
            { className: 'sa-side' },
            h(
              'div',
              { className: 'sa-search' },
              h('span', { className: 'sa-search-icon' }, h(SearchIcon, { size: 13 })),
              h('input', {
                className: 'sa-input sa-input-search',
                type: 'search',
                value: query,
                placeholder: t('search.placeholder'),
                onChange: (event) => setQuery(event.target.value),
              }),
            ),
            h(
              'div',
              { className: 'sa-scroll' },
              loadingSessions && sessions.length === 0
                ? h('div', { className: 'sa-side-note' }, t('list.loading'))
                : null,
              !loadingSessions && filtered.length === 0
                ? h('div', { className: 'sa-side-note' }, t('list.empty'))
                : null,
              filtered.map((session) =>
                h(
                  'button',
                  {
                    type: 'button',
                    key: session.id,
                    className: session.id === selectedId ? 'sa-row is-active' : 'sa-row',
                    onClick: () => pick(session),
                  },
                  h(
                    'span',
                    { className: 'sa-row-top' },
                    h('span', { className: 'sa-row-title' }, session.title || session.id),
                    session.live ? h('span', { className: 'sa-live-dot', title: t('nav.label') }) : null,
                  ),
                  h(
                    'span',
                    { className: 'sa-row-meta' },
                    h('span', null, relativeTime(t, session.createdAt)),
                    session.workspace ? h('span', { className: 'sa-sep' }, '·') : null,
                    session.workspace ? h('span', { className: 'sa-row-ws' }, session.workspace) : null,
                  ),
                ),
              ),
            ),
          ),
          h(
            'section',
            { className: 'sa-detail' },
            h(
              'div',
              { className: 'sa-detail-inner' },
              error ? h('div', { className: 'sa-note sa-note-error' }, error) : null,
              notice
                ? h(
                    'div',
                    { className: 'sa-note sa-note-ok' },
                    h('span', { className: 'sa-note-text' }, `${t('save.ok')} · `, h('code', null, notice)),
                  )
                : null,
              !selected
                ? h(EmptyState, { t })
                : h(
                    React.Fragment,
                    null,
                    h(Hero, { session: selected, busy: digesting, hasDraft: Boolean(draft), onDigest: runDigest, t }),
                    draft
                      ? h(
                          React.Fragment,
                          null,
                          h(StatStrip, { stats: draft.stats, t }),
                          h(
                            'section',
                            { className: 'sa-form' },
                            h(
                              'div',
                              { className: 'sa-field' },
                              h('label', { className: 'sa-label', htmlFor: 'sa-name' }, t('form.name')),
                              h('input', {
                                id: 'sa-name',
                                className: 'sa-input sa-mono',
                                value: name,
                                spellCheck: false,
                                onChange: (event) => setName(event.target.value),
                              }),
                              h('span', { className: 'sa-help' }, t('form.nameHint')),
                            ),
                            h(
                              'div',
                              { className: 'sa-field' },
                              h(
                                'label',
                                { className: 'sa-label', htmlFor: 'sa-description' },
                                t('form.description'),
                              ),
                              h('input', {
                                id: 'sa-description',
                                className: 'sa-input',
                                value: description,
                                onChange: (event) => setDescription(event.target.value),
                              }),
                            ),
                            h(
                              'div',
                              { className: 'sa-field' },
                              h('label', { className: 'sa-label', htmlFor: 'sa-when' }, t('form.when')),
                              h('textarea', {
                                id: 'sa-when',
                                className: 'sa-input sa-textarea',
                                rows: 2,
                                value: whenToUse,
                                onChange: (event) => setWhenToUse(event.target.value),
                              }),
                            ),
                          ),
                          h(DocView, { draft, name, description, whenToUse, t }),
                          h(
                            'div',
                            { className: 'sa-savebar' },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'sa-btn sa-btn-primary',
                                disabled: saving,
                                onClick: () => save(false),
                              },
                              saving ? t('save.busy') : t('save.run'),
                            ),
                            conflict
                              ? h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'sa-btn',
                                    disabled: saving,
                                    onClick: () => save(true),
                                  },
                                  t('save.overwrite'),
                                )
                              : null,
                            (draft.body ?? '').length > 0
                              ? h('span', { className: 'sa-hint' }, t('doc.chars', { count: (draft.body ?? '').length }))
                              : null,
                          ),
                        )
                      : null,
                  ),
              h(Library, {
                skills,
                skillsDir,
                copied,
                onCopy: copy,
                onDelete: removeSkill,
                pendingDelete,
                t,
              }),
            ),
          ),
        ),
      )
    }

    const CSS = `
.sa-root { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-size:13px; -webkit-font-smoothing:antialiased; }
.sa-root * { box-sizing:border-box; }

.sa-head { display:flex; align-items:center; gap:13px; padding:17px 24px 15px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.sa-mark { flex:0 0 auto; width:34px; height:34px; display:grid; place-items:center; border-radius:10px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-brand-primary); }
.sa-head-text { flex:1; min-width:0; }
.sa-title { font-size:15.5px; font-weight:600; letter-spacing:.01em; line-height:1.3; }
.sa-sub { margin-top:3px; font-size:12px; line-height:1.55; color:var(--dsw-alias-label-secondary); }
.sa-head-meta { flex:0 0 auto; display:flex; align-items:center; gap:8px; }
.sa-badge { display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 10px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); font-size:11.5px; white-space:nowrap; }

.sa-body { flex:1; min-height:0; display:flex; }

.sa-side { flex:0 0 306px; width:306px; min-height:0; display:flex; flex-direction:column; border-right:1px solid var(--dsw-alias-border-l1); }
.sa-search { position:relative; padding:12px 14px 8px; }
.sa-search-icon { position:absolute; left:23px; top:50%; transform:translateY(-46%); display:flex; color:var(--dsw-alias-label-secondary); pointer-events:none; }
.sa-input { width:100%; height:32px; padding:0 10px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); color:inherit; font:inherit; font-size:12.5px; outline:none; transition:border-color .12s ease, box-shadow .12s ease; }
.sa-input:hover { border-color:var(--dsw-alias-border-l2); }
.sa-input:focus { border-color:var(--dsw-alias-brand-primary); box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.sa-input-search { padding-left:29px; }
.sa-input::placeholder { color:var(--dsw-alias-label-secondary); }
.sa-textarea { height:auto; min-height:56px; padding:8px 10px; line-height:1.6; resize:vertical; }
.sa-scroll { flex:1; min-height:0; overflow:auto; padding:2px 10px 16px; }
.sa-side-note { padding:14px 6px; font-size:12px; color:var(--dsw-alias-label-secondary); }

.sa-row { position:relative; display:flex; flex-direction:column; gap:4px; width:100%; padding:10px 11px; border:1px solid transparent; border-radius:10px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; transition:background .12s ease, border-color .12s ease; }
.sa-row + .sa-row { margin-top:2px; }
.sa-row:hover { background:var(--dsw-alias-bg-layer-1); }
.sa-row:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.sa-row.is-active { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l1); }
.sa-row.is-active::before { content:''; position:absolute; left:-1px; top:9px; bottom:9px; width:2px; border-radius:2px; background:var(--dsw-alias-brand-primary); }
.sa-row-top { display:flex; align-items:flex-start; gap:8px; }
.sa-row-title { flex:1; min-width:0; font-size:12.5px; font-weight:500; line-height:1.45; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.sa-row-meta { display:flex; align-items:center; gap:6px; min-width:0; font-size:11px; color:var(--dsw-alias-label-secondary); }
.sa-row-ws { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sa-sep { opacity:.5; }
.sa-live-dot { flex:0 0 auto; width:6px; height:6px; margin-top:5px; border-radius:50%; background:var(--dsw-alias-state-success-primary); }

.sa-detail { flex:1; min-width:0; min-height:0; overflow:auto; padding:20px 26px 0; }
.sa-detail-inner { display:flex; flex-direction:column; gap:14px; max-width:920px; padding-bottom:26px; }

.sa-hero { display:flex; flex-direction:column; gap:14px; padding:18px 18px 15px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.sa-hero-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
.sa-hero-title-wrap { min-width:0; }
.sa-hero-title { margin:0; font-size:15px; font-weight:600; line-height:1.4; }
.sa-hero-sub { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-top:5px; font-size:11.5px; color:var(--dsw-alias-label-secondary); }
.sa-live { display:inline-flex; align-items:center; gap:5px; }
.sa-meta-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px 20px; padding-top:13px; border-top:1px solid var(--dsw-alias-border-l1); }
.sa-meta-item { display:flex; flex-direction:column; gap:3px; min-width:0; }
.sa-meta-wide { grid-column:1 / -1; }
.sa-meta-key { font-size:10px; font-weight:500; letter-spacing:.06em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.sa-meta-value { font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sa-offline { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--dsw-alias-label-secondary); }

.sa-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:30px; padding:0 14px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; font-weight:500; white-space:nowrap; cursor:pointer; transition:opacity .12s ease, border-color .12s ease; }
.sa-btn:hover:not(:disabled) { border-color:var(--dsw-alias-border-l2); }
.sa-btn:disabled { opacity:.55; cursor:default; }
.sa-btn-primary { background:var(--dsw-alias-brand-primary); border-color:transparent; color:#fff; }
.sa-btn-primary:hover:not(:disabled) { opacity:.92; }
.sa-hint { font-size:11px; color:var(--dsw-alias-label-secondary); }

.sa-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(96px, 1fr)); overflow:hidden; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.sa-stat { display:flex; flex-direction:column; gap:2px; padding:12px 14px; }
.sa-stat + .sa-stat { border-left:1px solid var(--dsw-alias-border-l1); }
.sa-stat-num { font-size:17px; font-weight:600; line-height:1.2; font-variant-numeric:tabular-nums; }
.sa-stat-label { font-size:10.5px; letter-spacing:.03em; color:var(--dsw-alias-label-secondary); }

.sa-form { display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.sa-field { display:flex; flex-direction:column; gap:5px; }
.sa-label { font-size:11.5px; font-weight:500; color:var(--dsw-alias-label-secondary); }
.sa-help { font-size:10.5px; line-height:1.5; color:var(--dsw-alias-label-secondary); opacity:.85; }

.sa-doc { overflow:hidden; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.sa-doc-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 16px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.sa-doc-title { display:flex; align-items:center; gap:7px; min-width:0; font-size:12px; font-weight:600; }
.sa-doc-hint { font-size:10.5px; font-weight:400; color:var(--dsw-alias-label-secondary); }
.sa-tabs { display:inline-flex; gap:2px; padding:2px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.sa-tab { appearance:none; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:11.5px; padding:4px 11px; cursor:pointer; }
.sa-tab.is-on { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1); }
.sa-doc-body { max-height:520px; overflow:auto; padding:16px 20px 18px; }
.sa-doc-h1 { margin:0 0 12px; font-size:15px; font-weight:600; line-height:1.4; }
.sa-doc-h2 { margin:20px 0 9px; padding-bottom:6px; border-bottom:1px solid var(--dsw-alias-border-l1); font-size:11.5px; font-weight:600; letter-spacing:.05em; color:var(--dsw-alias-label-secondary); }
.sa-doc-h2:first-child { margin-top:0; }
.sa-doc-p { margin:0 0 10px; font-size:12.5px; line-height:1.75; }
.sa-doc-quote { margin:0 0 14px; padding:9px 13px; border-left:2px solid var(--dsw-alias-brand-primary); border-radius:0 8px 8px 0; background:var(--dsw-alias-bg-layer-2); font-size:11.5px; line-height:1.7; color:var(--dsw-alias-label-secondary); }
.sa-doc-list { margin:0 0 12px; padding-left:20px; }
.sa-doc-list li { margin:0 0 6px; font-size:12.5px; line-height:1.7; }
.sa-doc-list li::marker { color:var(--dsw-alias-label-secondary); }
.sa-code { padding:1px 5px; border-radius:5px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; word-break:break-word; }
.sa-pre { margin:0; padding:12px 14px; border-radius:9px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; line-height:1.65; white-space:pre-wrap; word-break:break-word; }

.sa-savebar { position:sticky; bottom:0; z-index:2; display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:12px 0 14px; border-top:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); }

.sa-note { display:flex; align-items:center; gap:8px; padding:9px 12px; border-radius:10px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); font-size:11.5px; line-height:1.55; color:var(--dsw-alias-label-secondary); }
.sa-note-error { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
.sa-note-ok { color:var(--dsw-alias-label-secondary); }
.sa-note-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.sa-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; min-height:330px; padding:56px 24px 40px; text-align:center; }
.sa-empty-glyph { display:grid; place-items:center; width:72px; height:72px; margin-bottom:2px; border-radius:22px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-brand-primary); }
.sa-empty-title { font-size:14px; font-weight:600; }
.sa-empty-hint { max-width:430px; margin:0; font-size:12px; line-height:1.75; color:var(--dsw-alias-label-secondary); }
.sa-empty-points { display:flex; flex-wrap:wrap; justify-content:center; gap:8px 18px; margin-top:6px; }
.sa-point { display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--dsw-alias-label-secondary); }
.sa-point-dot { width:4px; height:4px; border-radius:50%; background:var(--dsw-alias-brand-primary); }

.sa-lib { display:flex; flex-direction:column; margin-top:8px; padding-top:16px; border-top:1px solid var(--dsw-alias-border-l1); }
.sa-lib-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
.sa-section-title { font-size:12px; font-weight:600; letter-spacing:.01em; }
.sa-lib-empty { margin:0; padding:10px 0 2px; font-size:12px; line-height:1.7; color:var(--dsw-alias-label-secondary); }
.sa-skill { display:flex; align-items:flex-start; gap:12px; padding:12px 14px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); }
.sa-skill + .sa-skill { margin-top:8px; }
.sa-monogram { flex:0 0 auto; display:grid; place-items:center; width:28px; height:28px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-brand-primary); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:10.5px; font-weight:600; }
.sa-skill-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.sa-skill-name { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; font-weight:600; }
.sa-skill-desc { margin:0; font-size:11.5px; line-height:1.55; color:var(--dsw-alias-label-secondary); overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.sa-skill-meta { display:flex; align-items:center; gap:6px; min-width:0; font-size:10.5px; color:var(--dsw-alias-label-secondary); }
.sa-skill-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:10px; opacity:.8; }

.sa-mini { display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 9px; border-radius:7px; border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:11px; white-space:nowrap; cursor:pointer; }
.sa-mini:hover { border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); }
.sa-mini-danger { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
.sa-mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }

@media (prefers-reduced-motion: reduce) { .sa-row, .sa-btn, .sa-input { transition:none; } }
`

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        host = ctx
        ctx.effect(() => ctx.locale.register(NS, { zh, en }))
        const t = (key, params) => {
          try {
            return ctx.locale.bind(NS)(key, params)
          } catch {
            return key
          }
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL, order: 20, label: () => t('nav.label') },
            NavIcon,
          ),
        )

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page))
      },
    }
  },
})
