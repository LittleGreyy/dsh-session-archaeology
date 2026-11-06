/**
 * Session Archaeology — Host half.
 *
 * Reads one committed session log on request, distils it into a reusable Skill
 * draft entirely offline (no model calls), and stores the accepted draft in a
 * skill library that is published to `ctx.skills`.
 */
import { buildDigest, renderSkillFile } from './digest.js'
import { createSkillProvider, listSkills, removeSkill, resolveRoots, saveSkill } from './skill-store.js'

export const name = 'session-archaeology'
export const inject = ['webServer', 'sessionQuery', 'skills']

const PREFIX = '/session-archaeology'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_SESSIONS = 300

export function apply(ctx) {
  const roots = resolveRoots()
  let control

  const json = (res, status, value) => {
    const body = JSON.stringify(value)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (chunks.length === 0) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(new Error(`invalid JSON body: ${error.message}`))
        }
      })
      req.on('error', reject)
    })

  async function listSessionSummaries() {
    const records = await ctx.sessionQuery.listSessions()
    const usable = records
      .filter((record) => record?.header && !record.header.isSeeded && record.header.origin !== 'subagent')
      .slice(0, MAX_SESSIONS)

    const ids = usable.map((record) => record.header.id)
    const titles = new Map()
    if (ids.length > 0) {
      try {
        for (const result of await ctx.sessionQuery.readTitleSnapshots(ids)) {
          if (result?.status === 'fulfilled' && result.value?.title?.title) {
            titles.set(String(result.sessionId), String(result.value.title.title))
          }
        }
      } catch {
        // Titles are a nicety; the list still works without them.
      }
    }

    return usable
      .map((record) => {
        const header = record.header
        const cwd = typeof header.cwd === 'string' ? header.cwd : ''
        return {
          id: String(header.id),
          title: titles.get(String(header.id)) ?? '',
          createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
          cwd,
          workspace: cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() ?? '' : '',
          live: record.live === true,
          persisted: record.persisted === true,
          agentPreset: header.agentPreset ?? '',
          parentSession: header.parentSession ? String(header.parentSession) : '',
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async function digestSession(sessionId, lang) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { status: 'invalid-session', message: 'sessionId is required' }
    }
    const log = await ctx.sessionQuery.readSession(sessionId)
    let title
    try {
      title = (await ctx.sessionQuery.readTitle(sessionId))?.title
    } catch {
      title = undefined
    }
    const draft = buildDigest(log, { title, lang })
    return { status: 'ok', draft, title: title ?? '', skillsDir: roots.skills }
  }

  async function handleSave(payload) {
    const draft = payload?.draft ?? {}
    const name = String(draft.name ?? '').trim()
    const now = Date.now()
    const text = renderSkillFile(
      {
        name,
        description: String(draft.description ?? ''),
        whenToUse: String(draft.whenToUse ?? ''),
        sessionId: String(draft.sessionId ?? ''),
        body: String(draft.body ?? ''),
      },
      now,
    )
    const meta = {
      kind: 'session-archaeology',
      name,
      sessionId: String(draft.sessionId ?? ''),
      sessionTitle: String(draft.title ?? ''),
      lang: draft.lang === 'en' ? 'en' : 'zh',
      distilledAt: new Date(now).toISOString(),
      stats: draft.stats ?? {},
      evidence: draft.evidence ?? {},
    }
    const result = await saveSkill(
      roots,
      { name, body: draft.body, text, meta },
      { overwrite: payload?.overwrite === true },
    )
    if (result.status === 'saved') control?.invalidate()
    return result
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.slice(PREFIX.length)
    const method = req.method ?? 'GET'

    try {
      if (method === 'GET' && route === '/sessions') {
        return json(res, 200, { sessions: await listSessionSummaries(), skillsDir: roots.skills })
      }
      if (method === 'GET' && route === '/skills') {
        const skills = await listSkills(roots)
        return json(res, 200, {
          skills: skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            whenToUse: skill.whenToUse ?? '',
            sourceSession: skill.sourceSession ?? '',
            distilledAt: skill.distilledAt ?? '',
            bytes: skill.bytes,
            dir: skill.dir,
            file: skill.file,
            sessionTitle: skill.meta?.sessionTitle ?? '',
            stats: skill.meta?.stats ?? {},
          })),
          skillsDir: roots.skills,
        })
      }
      if (method === 'POST' && route === '/digest') {
        const payload = await readJson(req)
        const result = await digestSession(payload?.sessionId, payload?.lang)
        return json(res, result.status === 'ok' ? 200 : 400, result)
      }
      if (method === 'POST' && route === '/save') {
        const payload = await readJson(req)
        const result = await handleSave(payload)
        const status = result.status === 'saved' ? 200 : result.status === 'exists' ? 409 : 400
        return json(res, status, result)
      }
      if (method === 'POST' && route === '/delete') {
        const payload = await readJson(req)
        const result = await removeSkill(roots, payload?.name)
        if (result.status === 'removed') control?.invalidate()
        return json(res, result.status === 'removed' ? 200 : 404, result)
      }
      if (method === 'GET' && route === '/health') {
        return json(res, 200, { ok: true, skillsDir: roots.skills })
      }
      return json(res, 404, { error: 'not found', route, method })
    } catch (error) {
      return json(res, 500, { error: String(error?.message ?? error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle }))

  // The library provider is an enhancement: a registration failure must never cost the page.
  ctx.effect(() => {
    try {
      return ctx.skills.registerProvider((providerControl) => {
        control = providerControl
        return createSkillProvider(roots)
      })
    } catch (error) {
      console.error('[session-archaeology] skill provider registration failed:', error)
      return () => {}
    }
  })
}
