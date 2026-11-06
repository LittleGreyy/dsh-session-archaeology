/**
 * The distilled-skill library: plain directories under
 * `<DSH_HOME>/session-archaeology/skills/<name>/`, each holding a SKILL.md and a
 * meta.json evidence index. Also serves them to `ctx.skills` through a provider,
 * so a distilled skill is immediately loadable by every agent in the profile.
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function resolveRoots(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() ? env.DSH_HOME.trim() : path.join(os.homedir(), '.dsh')
  const root = path.join(home, 'session-archaeology')
  return { home, root, skills: path.join(root, 'skills') }
}

export function isValidSkillName(name) {
  return typeof name === 'string' && name.length >= 2 && name.length <= 64 && SKILL_NAME.test(name)
}

function parseScalar(raw) {
  const text = raw.trim()
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1)
  return text
}

/** Split `---` frontmatter from the markdown body. */
export function parseSkillFile(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  if (!source.startsWith('---')) return { frontmatter: {}, body: source.trim() }
  const end = source.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: source.trim() }
  const head = source.slice(3, end).replace(/^\r?\n/, '')
  const body = source.slice(source.indexOf('\n', end + 1) + 1).trim()
  const frontmatter = {}
  for (const line of head.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    frontmatter[match[1]] = parseScalar(match[2])
  }
  return { frontmatter, body }
}

function invocationOf(frontmatter) {
  const modelInvocable = String(frontmatter['model-invocable'] ?? 'true') !== 'false'
  return { modelInvocable, userInvocable: true }
}

async function readSkillDir(dir) {
  const file = path.join(dir, 'SKILL.md')
  const raw = await readFile(file, 'utf8')
  const { frontmatter, body } = parseSkillFile(raw)
  const name = String(frontmatter.name ?? path.basename(dir))
  let meta = {}
  try {
    meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
  } catch {
    meta = {}
  }
  const stats = await stat(file).catch(() => undefined)
  return {
    name,
    dir,
    file,
    description: String(frontmatter.description ?? ''),
    whenToUse: frontmatter['when-to-use'] ? String(frontmatter['when-to-use']) : undefined,
    sourceSession: frontmatter['source-session'] ? String(frontmatter['source-session']) : undefined,
    distilledAt: frontmatter['distilled-at'] ? String(frontmatter['distilled-at']) : undefined,
    bytes: stats?.size ?? Buffer.byteLength(raw, 'utf8'),
    meta,
    body,
  }
}

export async function listSkills(roots) {
  let entries
  try {
    entries = await readdir(roots.skills, { withFileTypes: true })
  } catch {
    return []
  }
  const skills = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(roots.skills, entry.name)
    try {
      const skill = await readSkillDir(dir)
      if (!isValidSkillName(skill.name)) continue
      skills.push(skill)
    } catch {
      // A hand-edited or half-written directory is skipped, never fatal.
    }
  }
  skills.sort((a, b) => String(b.distilledAt ?? '').localeCompare(String(a.distilledAt ?? '')))
  return skills
}

export async function saveSkill(roots, draft, options = {}) {
  const name = String(draft?.name ?? '').trim()
  if (!isValidSkillName(name)) {
    return { status: 'invalid-name', message: 'skill name must be kebab-case: a-z, 0-9 and single dashes' }
  }
  const body = String(draft?.body ?? '')
  if (body.trim().length < 20) return { status: 'invalid-body', message: 'skill body is empty' }

  const dir = path.join(roots.skills, name)
  const exists = await stat(dir).then(
    () => true,
    () => false,
  )
  if (exists && options.overwrite !== true) return { status: 'exists', name, dir }

  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')
  const text = String(draft.text ?? body).replace(/\s+$/, '') + '\n'
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, text, 'utf8')
  await rename(temp, file)

  if (draft.meta && typeof draft.meta === 'object') {
    await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(draft.meta, null, 2)}\n`, 'utf8')
  }
  return { status: 'saved', name, dir, file, overwritten: exists, bytes: Buffer.byteLength(text, 'utf8') }
}

export async function removeSkill(roots, name) {
  if (!isValidSkillName(name)) return { status: 'invalid-name' }
  const dir = path.join(roots.skills, name)
  const exists = await stat(dir).then(
    () => true,
    () => false,
  )
  if (!exists) return { status: 'missing' }
  await rm(dir, { recursive: true, force: true })
  return { status: 'removed', name }
}

/**
 * A `ctx.skills` provider over the library directory. Registration happens once;
 * `control.invalidate()` publishes a save or a delete to the skill catalog.
 */
export function createSkillProvider(roots) {
  return {
    name: 'session-archaeology',
    async list() {
      const skills = await listSkills(roots)
      return {
        candidates: skills.map((skill, index) => ({
          name: skill.name,
          description: skill.description,
          whenToUse: skill.whenToUse,
          invocation: invocationOf({}),
          source: 'custom',
          provider: 'session-archaeology',
          resourceBase: { kind: 'directory', path: skill.dir },
          rank: index,
          locator: skill.dir,
          path: skill.file,
          metadata: {
            sessionId: skill.sourceSession,
            distilledAt: skill.distilledAt,
            bytes: skill.bytes,
          },
        })),
        complete: true,
      }
    },
    async get(candidate) {
      const dir = String(candidate?.locator ?? '')
      if (!dir) return undefined
      let skill
      try {
        skill = await readSkillDir(dir)
      } catch {
        return undefined
      }
      return {
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        invocation: invocationOf({}),
        source: 'custom',
        provider: 'session-archaeology',
        resourceBase: { kind: 'directory', path: skill.dir },
        path: skill.file,
        content: skill.body,
        metadata: {
          sessionId: skill.sourceSession,
          distilledAt: skill.distilledAt,
          bytes: skill.bytes,
        },
      }
    },
  }
}
