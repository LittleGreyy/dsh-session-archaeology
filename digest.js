/**
 * Offline distillation: turn one committed session log into a reusable Skill draft.
 *
 * Pure functions only — no model calls, no network, no clock except an injected `now`.
 * Evidence for every claim is a session event `seq`, so the produced skill can be
 * traced back into the log it came from.
 */

const NOISE_TOOLS = new Set([
  'todo_write',
  'get_goal',
  'update_goal',
  'create_goal',
  'ask_user_question',
  'skill',
  'list_agents',
])

const FILE_TOOLS = new Set(['read', 'write', 'edit', 'glob', 'grep', 'read_image', 'present'])

const CORRECTION_RE =
  /^(不对|错了|不是|重新|别|不要|改成|换成|应该|重来|再试)|应该(是|用|改|这样)|不要再|换一种|重来一次|\b(instead|actually|wrong|not what|try again|don'?t|that'?s not)\b/i

const VERIFY_RE =
  /\b(test|tests|build|lint|check|typecheck|tsc|verify|validate|pytest|vitest|jest|cargo|gcc|g\+\+|clang|cmake|make|node|python|npm|pnpm|yarn|npx|run|start)\b/i

const SUCCESS_RE =
  /\b(success|succeeded|passed|passing|ok|green|built|completed|0 errors|exit: 0|exit code 0|exitcode: 0)\b/i

/** A correction farther than this from a fix is about something else. */
const CORRECTION_WINDOW = 30

const LABELS = {
  zh: {
    generated: '由「会话考古」从历史会话离线蒸馏（无模型调用）。括号中的 #序号 指向源会话事件 seq，可用于回查。',
    whenToUse: '何时使用',
    steps: '步骤',
    files: '关键文件',
    pitfalls: '坑与修正',
    verify: '验证',
    origin: '出处',
    corrections: '用户纠正',
    overruled: (seq) => `；随后被用户纠正 #${seq}`,
    intent: '意图',
    symptom: '现象',
    fix: '修正',
    none: '（该会话没有可提炼的工具调用）',
    edited: (n) => `编辑 ${n} 次`,
    session: '会话',
    created: '创建',
    range: '事件范围',
    distilled: '蒸馏',
    ruleBased: '规则蒸馏',
    events: (n) => `${n} 条事件`,
  },
  en: {
    generated:
      'Distilled offline from a historical session by Session Archaeology (no model calls). Each #seq points at a source session event for tracing.',
    whenToUse: 'When to use',
    steps: 'Steps',
    files: 'Key files',
    pitfalls: 'Pitfalls and fixes',
    verify: 'Verification',
    origin: 'Origin',
    corrections: 'User corrections',
    overruled: (seq) => `; later overruled by the user #${seq}`,
    intent: 'intent',
    symptom: 'symptom',
    fix: 'fix',
    none: '(no extractable tool calls in this session)',
    edited: (n) => `edited ${n}x`,
    session: 'Session',
    created: 'Created',
    range: 'Event range',
    distilled: 'Distilled',
    ruleBased: 'rule-based',
    events: (n) => `${n} events`,
  },
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function oneLine(value, max = 160) {  if (typeof value !== 'string') return ''
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function firstSentence(value, max = 120) {
  if (typeof value !== 'string') return ''
  const flat = value.replace(/\s+/g, ' ').trim()
  const cut = flat.split(/(?<=[。！？!?])|(?<=\.)\s/)[0] ?? flat
  return oneLine(cut, max)
}

function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function parseArgs(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function commandOf(args) {
  for (const key of ['command', 'cmd', 'script', 'shell']) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key]
  }
  return undefined
}

function pathOf(args) {
  for (const key of ['file_path', 'path', 'filePath', 'target', 'notebook_path']) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key]
  }
  return undefined
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Walk the raw log once and pair every `tool/call` with its `tool/result`. */
function collectCalls(events) {
  const calls = []
  const pending = new Map()
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (event.type === 'tool/call') {
      const data = event.data ?? {}
      const callId = String(data.callId ?? `${event.seq}`)
      const record = {
        callId,
        name: String(data.name ?? 'tool'),
        rawArgs: typeof data.arguments === 'string' ? data.arguments : '',
        args: parseArgs(data.arguments),
        seq: event.seq,
        turn: data.turn,
        step: data.step,
        resultSeq: undefined,
        resultText: '',
        isError: false,
        errorInfo: null,
      }
      calls.push(record)
      pending.set(callId, record)
    } else if (event.type === 'tool/result') {
      const data = event.data ?? {}
      const message = data.message ?? {}
      const callId = String(message.toolCallId ?? message.source?.callId ?? '')
      const record = pending.get(callId)
      if (!record) continue
      record.resultSeq = event.seq
      record.resultText = textOf(message.content)
      record.isError = Boolean(message.isError || data.error)
      record.errorInfo = data.error ?? null
    }
  }
  return calls
}

/** Segment into episodes: one user message plus everything the agent did for it. */
function collectEpisodes(events) {
  const episodes = []
  let current = null
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (event.type === 'user/message') {
      const text = textOf(event.data?.content)
      current = { seq: event.seq, time: event.time, userText: text, assistant: [], calls: [] }
      episodes.push(current)
    } else if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (!current) {
        current = { seq: event.seq, time: event.time, userText: '', assistant: [], calls: [] }
        episodes.push(current)
      }
      if (text) current.assistant.push({ seq: event.seq, text })
    } else if (event.type === 'tool/call') {
      if (!current) {
        current = { seq: event.seq, time: event.time, userText: '', assistant: [], calls: [] }
        episodes.push(current)
      }
      current.calls.push({ seq: event.seq, name: String(event.data?.name ?? 'tool') })
    }
  }
  return episodes
}

function describeCall(call) {
  const command = commandOf(call.args)
  if (command) return `\`${oneLine(command, 110)}\``
  const target = pathOf(call.args)
  if (target) return `${call.name} \`${oneLine(target, 100)}\``
  if (call.name === 'web_search') {
    const query = Array.isArray(call.args.queries) ? call.args.queries[0] : undefined
    if (query) return `web_search \`${oneLine(String(query), 80)}\``
  }
  if (call.name === 'web_fetch' && typeof call.args.url === 'string') {
    return `web_fetch \`${oneLine(call.args.url, 90)}\``
  }
  if (FILE_TOOLS.has(call.name)) return call.name
  const evidence = oneLine(call.rawArgs.replace(/`/g, "'"), 70)
  return evidence ? `${call.name} \`${evidence}\`` : call.name
}

function intentFor(call, episode) {
  if (!episode) return ''
  let best = ''
  for (const message of episode.assistant) {
    if (message.seq < call.seq) best = message.text
    else break
  }
  return firstSentence(best, 110)
}

function chooseEpisode(episodes, callsBySeq) {
  let best = null
  let bestScore = -1
  for (const episode of episodes) {
    let score = 0
    for (const entry of episode.calls) {
      const call = callsBySeq.get(entry.seq)
      if (!call || NOISE_TOOLS.has(call.name)) continue
      if (call.isError) continue
      score += 1
    }
    if (score >= bestScore) {
      best = episode
      bestScore = score
    }
  }
  return { episode: best, score: bestScore }
}

function buildSteps(episode, callsBySeq, limit = 14) {
  if (!episode) return []
  const steps = []
  const seen = new Set()
  let lastIntent = ''
  for (const entry of episode.calls) {
    const call = callsBySeq.get(entry.seq)
    if (!call || NOISE_TOOLS.has(call.name) || call.isError) continue
    const text = describeCall(call)
    if (seen.has(text)) continue
    seen.add(text)
    const intent = intentFor(call, episode)
    steps.push({ text, seq: call.seq, intent: intent === lastIntent ? '' : intent })
    lastIntent = intent
    if (steps.length >= limit) break
  }
  return steps
}

function buildFallbackSteps(calls, limit = 14) {
  const steps = []
  const seen = new Set()
  for (const call of calls) {
    if (NOISE_TOOLS.has(call.name) || call.isError) continue
    const text = describeCall(call)
    if (seen.has(text)) continue
    seen.add(text)
    steps.push({ text, seq: call.seq, intent: '' })
    if (steps.length >= limit) break
  }
  return steps
}

function buildPitfalls(episodes, callsBySeq, corrections, limit = 6) {
  const pitfalls = []
  const seenSymptoms = new Set()
  for (const episode of episodes) {
    let pendingFailure = null
    for (const entry of episode.calls) {
      const call = callsBySeq.get(entry.seq)
      if (!call) continue
      if (call.isError) {
        pendingFailure = call
        continue
      }
      if (!pendingFailure) continue
      const symptom = oneLine(pendingFailure.errorSignature ?? pendingFailure.resultText.split('\n')[0] ?? '', 150)
      if (!symptom || seenSymptoms.has(symptom)) {
        pendingFailure = null
        continue
      }
      seenSymptoms.add(symptom)
      // A fix the user later overruled must say so, or the skill teaches the discarded path.
      const overruled = corrections.find(
        (item) => item.seq > call.seq && item.seq - call.seq <= CORRECTION_WINDOW,
      )
      pitfalls.push({
        symptom,
        fix: describeCall(call),
        fromSeq: pendingFailure.seq,
        toSeq: call.seq,
        overruledAt: overruled?.seq,
        overruledBy: overruled?.text,
      })
      pendingFailure = null
      if (pitfalls.length >= limit) break
    }
    if (pitfalls.length >= limit) break
  }
  return pitfalls
}

function buildVerification(calls, limit = 6) {
  const items = []
  const seen = new Set()
  for (const call of calls) {
    if (call.isError) continue
    const command = commandOf(call.args)
    if (!command || !VERIFY_RE.test(command)) continue
    // A list of probed paths also matches "gcc"; only keep commands whose output
    // reads like a result, or that printed nothing at all.
    if (call.resultText && !SUCCESS_RE.test(call.resultText)) continue
    const text = `\`${oneLine(command, 110)}\``
    if (seen.has(text)) continue
    seen.add(text)
    items.push({ text, seq: call.seq })
    if (items.length >= limit) break
  }
  return items
}

function buildFiles(calls, limit = 8) {
  const byPath = new Map()
  for (const call of calls) {
    if (call.isError) continue
    if (call.name !== 'write' && call.name !== 'edit') continue
    const target = pathOf(call.args)
    if (!target) continue
    const entry = byPath.get(target) ?? { path: target, count: 0, firstSeq: call.seq }
    entry.count += 1
    byPath.set(target, entry)
  }
  return [...byPath.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

function buildCorrections(episodes, limit = 4) {
  const items = []
  const seen = new Set()
  for (const episode of episodes) {
    const text = oneLine(episode.userText, 200)
    if (!text || text.length > 200) continue
    if (!CORRECTION_RE.test(text)) continue
    if (seen.has(text)) continue
    seen.add(text)
    items.push({ text, seq: episode.seq })
    if (items.length >= limit) break
  }
  return items
}

function topTools(calls, limit = 3) {
  const counts = new Map()
  for (const call of calls) {
    if (NOISE_TOOLS.has(call.name)) continue
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name)
}

/**
 * @param {{ session: {id: string, createdAt?: number}, events: readonly object[] }} log
 * @param {{ title?: string, lang?: 'zh'|'en', now?: number }} options
 */
export function buildDigest(log, options = {}) {
  const lang = options.lang === 'en' ? 'en' : 'zh'
  const labels = LABELS[lang]
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const events = Array.isArray(log?.events) ? log.events : []
  const calls = collectCalls(events)
  const episodes = collectEpisodes(events)
  const callsBySeq = new Map(calls.map((call) => [call.seq, call]))

  // Attach a stable symptom line to every failed call for pitfall rendering.
  for (const call of calls) {
    if (!call.isError) continue
    const reason =
      (typeof call.errorInfo?.reason === 'string' && call.errorInfo.reason) ||
      (typeof call.errorInfo?.message === 'string' && call.errorInfo.message) ||
      call.resultText.split('\n')[0] ||
      call.errorInfo?.code ||
      ''
    call.errorSignature = oneLine(reason, 150)
  }

  const userMessages = events.filter((event) => event?.type === 'user/message')
  const assistantMessages = events.filter((event) => event?.type === 'assistant/message')
  const failures = calls.filter((call) => call.isError)
  const commands = calls.filter((call) => !call.isError && commandOf(call.args))

  const { episode: mainEpisode } = chooseEpisode(episodes, callsBySeq)
  let steps = buildSteps(mainEpisode, callsBySeq)
  if (steps.length < 2) steps = buildFallbackSteps(calls)

  const files = buildFiles(calls)
  const corrections = buildCorrections(episodes)
  const pitfalls = buildPitfalls(episodes, callsBySeq, corrections)
  const verification = buildVerification(calls)

  const firstUserText = userMessages.length > 0 ? textOf(userMessages[0].data?.content) : ''
  const title = oneLine(options.title || firstUserText || log?.session?.id || 'untitled', 72)
  const tools = topTools(calls)
  const slug = slugify(title)
  const created = new Date(typeof log?.session?.createdAt === 'number' ? log.session.createdAt : now)
  const dateKey = `${created.getFullYear()}${pad2(created.getMonth() + 1)}${pad2(created.getDate())}`
  const name =
    slug.length >= 3 ? slug : `session-${dateKey}-${String(log?.session?.id ?? 'session').slice(-6)}`

  const stepCount = steps.length
  const toolPhrase = tools.length > 0 ? tools.join('/') : lang === 'en' ? 'the recorded tools' : '会话中的工具'
  const whenToUse =
    lang === 'en'
      ? `Use when a task matches "${title}" and the verified ${stepCount}-step flow (${toolPhrase}) should be repeated instead of rediscovered.`
      : `当任务与「${title}」相同或相似，需要按已验证的 ${stepCount} 步流程（${toolPhrase}）复现，而不是重新摸索时使用。`
  const description =
    lang === 'en'
      ? `Distilled offline from the session "${title}": ${stepCount} steps with ${toolPhrase}${files.length > 0 ? `, touching ${files[0].path}` : ''}.`
      : `从会话「${title}」离线蒸馏：用 ${toolPhrase} 完成 ${stepCount} 步操作${files.length > 0 ? `，核心文件 ${files[0].path}` : ''}。`

  const firstSeq = events.length > 0 ? events[0].seq : 0
  const lastSeq = events.length > 0 ? events[events.length - 1].seq : 0

  const body = renderBody({
    lang,
    labels,
    title,
    whenToUse,
    steps,
    files,
    pitfalls,
    verification,
    corrections,
    sessionId: String(log?.session?.id ?? ''),
    createdAt: log?.session?.createdAt,
    firstSeq,
    lastSeq,
    eventCount: events.length,
    now,
  })

  return {
    lang,
    name,
    description,
    whenToUse,
    body,
    title,
    sessionId: String(log?.session?.id ?? ''),
    stats: {
      events: events.length,
      turns: episodes.length,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      toolCalls: calls.length,
      failures: failures.length,
      commands: commands.length,
      filesEdited: files.reduce((sum, file) => sum + file.count, 0),
      distinctFiles: files.length,
      episodeSteps: stepCount,
      pitfalls: pitfalls.length,
      verification: verification.length,
    },
    evidence: {
      steps: steps.map((step) => step.seq),
      pitfalls: pitfalls.map((item) => [item.fromSeq, item.toSeq]),
      verification: verification.map((item) => item.seq),
      corrections: corrections.map((item) => item.seq),
      firstSeq,
      lastSeq,
    },
  }
}

function renderBody(input) {
  const { lang, labels, title } = input
  const sep = lang === 'en' ? ': ' : '：'
  const wrap = (inner) => (lang === 'en' ? `(${inner})` : `（${inner}）`)
  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`> ${labels.generated}`)
  lines.push('')
  lines.push(`## ${labels.whenToUse}`)
  lines.push('')
  lines.push(input.whenToUse)
  lines.push('')

  lines.push(`## ${labels.steps}`)
  lines.push('')
  if (input.steps.length === 0) {
    lines.push(labels.none)
  } else {
    input.steps.forEach((step, index) => {
      const intent = step.intent ? ` — ${step.intent}` : ''
      lines.push(`${index + 1}. ${step.text}${intent}${wrap(`#${step.seq}`)}`)
    })
  }
  lines.push('')

  if (input.files.length > 0) {
    lines.push(`## ${labels.files}`)
    lines.push('')
    for (const file of input.files) {
      lines.push(`- \`${file.path}\` — ${labels.edited(file.count)}${wrap(`#${file.firstSeq}`)}`)
    }
    lines.push('')
  }

  if (input.pitfalls.length > 0) {
    lines.push(`## ${labels.pitfalls}`)
    lines.push('')
    for (const item of input.pitfalls) {
      lines.push(`- ${labels.symptom}${sep}${item.symptom}`)
      const overruled = item.overruledAt ? labels.overruled(item.overruledAt) : ''
      lines.push(`  ${labels.fix}${sep}${item.fix}${wrap(`#${item.fromSeq} → #${item.toSeq}${overruled}`)}`)
    }
    lines.push('')
  }

  if (input.corrections.length > 0) {
    lines.push(`## ${labels.corrections}`)
    lines.push('')
    for (const item of input.corrections) lines.push(`- ${item.text}${wrap(`#${item.seq}`)}`)
    lines.push('')
  }

  if (input.verification.length > 0) {
    lines.push(`## ${labels.verify}`)
    lines.push('')
    for (const item of input.verification) lines.push(`- ${item.text}${wrap(`#${item.seq}`)}`)
    lines.push('')
  }

  lines.push(`## ${labels.origin}`)
  lines.push('')
  lines.push(`- ${labels.session}${sep}${title}${lang === 'en' ? ' ' : ''}${wrap(`\`${input.sessionId}\``)}`)
  if (typeof input.createdAt === 'number') {
    lines.push(`- ${labels.created}${sep}${new Date(input.createdAt).toISOString()}`)
  }
  lines.push(`- ${labels.range}${sep}#${input.firstSeq} – #${input.lastSeq} ${wrap(labels.events(input.eventCount))}`)
  lines.push(`- ${labels.distilled}${sep}${new Date(input.now).toISOString()} · ${labels.ruleBased}`)

  return `${lines.join('\n')}\n`
}

/** Full SKILL.md text: YAML frontmatter plus the rendered body. */
export function renderSkillFile(draft, now = Date.now()) {
  const front = [
    '---',
    `name: ${draft.name}`,
    `description: ${JSON.stringify(draft.description)}`,
    `when-to-use: ${JSON.stringify(draft.whenToUse ?? '')}`,
    `source-session: ${JSON.stringify(draft.sessionId ?? '')}`,
    `distilled-at: ${JSON.stringify(new Date(now).toISOString())}`,
    '---',
    '',
  ].join('\n')
  return `${front}${draft.body.replace(/\s+$/, '')}\n`
}

export const DIGEST_LABELS = LABELS
