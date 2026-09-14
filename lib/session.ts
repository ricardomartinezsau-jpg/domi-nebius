// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

import { z } from 'zod'
import type { DetailOutput, QuickOutput } from './triage'

export const TRAYS = [
  { id: 'profesionalProductiva', name: 'Trabajo', color: 'trabajo' },
  { id: 'personalBienestar', name: 'Personal', color: 'personal' },
  { id: 'familiarDomestica', name: 'Casa', color: 'casa' },
  { id: 'socialComunitaria', name: 'Social', color: 'social' },
] as const
export type Tray = (typeof TRAYS)[number]['id']
const traySchema = z.enum(['personalBienestar', 'profesionalProductiva', 'familiarDomestica', 'socialComunitaria'])
const timestamp = z.number().finite().nonnegative()
const stepSchema = z.object({ id: z.string(), title: z.string(), hook: z.string(), minutes: z.number().nonnegative(), done: z.boolean() })
const taskSchema = z.object({
  id: z.string(), dumpId: z.string(), title: z.string(), tray: traySchema,
  done: z.boolean(), doneAt: timestamp.nullable(), steps: z.array(stepSchema),
  order: z.number(), dependsOn: z.array(z.string()), why: z.string(),
  researchRunId: z.string().optional(),
})
// Validate browser storage without importing the server-side inference module.
export const quickResultSchema = z.object({
  trayDispatch: z.object({ personalBienestar: z.array(z.string()), profesionalProductiva: z.array(z.string()), familiarDomestica: z.array(z.string()), socialComunitaria: z.array(z.string()) }),
  momentumMode: z.object({ activationHook: z.string(), cognitiveLoadLevel: z.enum(['baja', 'media', 'alta']), antiDopamineTraps: z.array(z.object({ activity: z.string(), warning: z.string() })), singleFocusShield: z.string() }),
})
const dumpSchema = z.object({ id: z.string(), rawText: z.string(), quick: quickResultSchema, createdAt: timestamp, detailStatus: z.enum(['pending', 'done', 'failed']) })
const runSchema = z.object({
  id: z.string(), taskId: z.string(), startedAt: timestamp, activeSince: timestamp.nullable(),
  activeMs: timestamp, checkpointAt: timestamp, endedAt: timestamp.nullable(),
  outcome: z.enum(['open', 'completed', 'stopped', 'reset']),
})
const sessionSchema = z.object({
  version: z.literal(1), draft: z.string(), screen: z.enum(['capture', 'trays', 'dominio', 'research']),
  tasks: z.array(taskSchema), dumps: z.array(dumpSchema), runs: z.array(runSchema),
  selectedTaskId: z.string().nullable(), activeRunId: z.string().nullable(),
  selectionByUser: z.boolean(), clockVisible: z.boolean(), updatedAt: timestamp,
  research: z.object({ runId: z.string().uuid(), tray: traySchema, title: z.string() }).optional(),
})
export type DomiTask = z.infer<typeof taskSchema>
export type FocusRun = z.infer<typeof runSchema>
export type DomiSession = z.infer<typeof sessionSchema>
export const STORAGE_KEY = 'domi.session.v1'

export function emptySession(): DomiSession {
  return { version: 1, draft: '', screen: 'capture', tasks: [], dumps: [], runs: [], selectedTaskId: null, activeRunId: null, selectionByUser: false, clockVisible: true, updatedAt: 0 }
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Ambiguous matches stay unmatched. Never attach somebody else's steps by list position. */
export function matchTask(title: string, tasks: DomiTask[]): DomiTask | undefined {
  const normalized = normalizeTitle(title)
  const exact = tasks.filter(task => normalizeTitle(task.title) === normalized)
  if (exact.length) return exact.length === 1 ? exact[0] : undefined
  const stop = new Set(['para', 'con', 'una', 'del', 'las', 'los', 'que', 'por', 'hoy'])
  const words = (value: string) => new Set(normalizeTitle(value).split(' ').filter(w => w.length > 2 && !stop.has(w)))
  const query = words(title)
  if (query.size < 2) return undefined
  const ranked = tasks.map(task => {
    const candidate = words(task.title)
    const intersection = [...query].filter(word => candidate.has(word)).length
    return { task, score: intersection / Math.max(query.size, candidate.size), intersection }
  }).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  return best && best.intersection >= 2 && best.score >= 0.75 && best.score - (ranked[1]?.score ?? 0) >= 0.2 ? best.task : undefined
}

export function activeRun(session: DomiSession): FocusRun | undefined {
  return session.runs.find(run => run.id === session.activeRunId)
}
export function elapsedMs(run: FocusRun, now: number): number {
  return run.activeMs + (run.activeSince === null ? 0 : Math.max(0, now - run.activeSince))
}
function pauseRun(run: FocusRun, now: number): FocusRun {
  return { ...run, activeMs: elapsedMs(run, now), activeSince: null, checkpointAt: now }
}

/** Resume after a reload in pause: time away is unknown, not evidence of work. */
export function restoreSession(serialized: string): DomiSession | null {
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(serialized))
    if (!parsed.success) return null
    const session = parsed.data
    const ids = new Set(session.tasks.map(task => task.id))
    if (ids.size !== session.tasks.length || session.runs.some(run => !ids.has(run.taskId))) return null
    if (session.selectedTaskId && !ids.has(session.selectedTaskId)) return null
    if (session.activeRunId && !session.runs.some(run => run.id === session.activeRunId && run.taskId === session.selectedTaskId)) return null
    if (session.screen === 'dominio' && !session.activeRunId) return null
    // Compatibility with sessions that used to keep the research id on a task.
    const legacy = session.tasks.find(task => task.id === session.selectedTaskId && task.researchRunId)
      ?? [...session.tasks].reverse().find(task => task.researchRunId)
    const research = session.research ?? (legacy && z.string().uuid().safeParse(legacy.researchRunId).success
      ? { runId: legacy.researchRunId!, tray: legacy.tray, title: legacy.title } : undefined)
    return {
      ...session,
      research,
      screen: session.screen === 'research' && !research ? 'trays' : session.screen,
      runs: session.runs.map(run => run.activeSince === null ? run : pauseRun(run, Math.max(run.activeSince, run.checkpointAt))),
      dumps: session.dumps.map(dump => dump.detailStatus === 'pending' ? { ...dump, detailStatus: 'failed' } : dump),
    }
  } catch { return null }
}

export type SessionAction =
  | { type: 'draft'; text: string }
  | { type: 'quick'; id: string; rawText: string; quick: QuickOutput; now: number }
  | { type: 'detail'; dumpId: string; detail: DetailOutput }
  | { type: 'detailStatus'; dumpId: string; status: 'pending' | 'failed' }
  | { type: 'choose'; taskId: string }
  | { type: 'move'; taskId: string; tray: Tray }
  | { type: 'step'; taskId: string; stepId: string }
  | { type: 'research'; taskId: string; runId: string }
  | { type: 'trayResearch'; tray: Tray; runId: string; title: string }
  | { type: 'start'; taskId: string; runId: string; now: number }
  | { type: 'pause' | 'resume' | 'checkpoint' | 'leave' | 'stop' | 'finish'; now: number }
  | { type: 'resetClock'; runId: string; now: number }
  | { type: 'screen'; screen: 'capture' | 'trays' | 'research'; now: number }
  | { type: 'clockVisible' }
  | { type: 'addTaskFromResearch'; title: string; tray: Tray; now: number }

export function sessionReducer(session: DomiSession, action: SessionAction): DomiSession {
  switch (action.type) {
    case 'draft': return { ...session, draft: action.text }
    case 'quick': {
      if (session.dumps.some(dump => dump.id === action.id)) return session
      const tasks: DomiTask[] = TRAYS.flatMap(tray => action.quick.trayDispatch[tray.id].filter(title => title.trim()).map((title, index) => ({
        id: `${action.id}:${tray.id}:${index}`, dumpId: action.id, title: title.trim(), tray: tray.id,
        done: false, doneAt: null, steps: [], order: 999, dependsOn: [], why: '',
      })))
      const suggested = matchTask(action.quick.momentumMode.activationHook, tasks)
      return {
        ...session, screen: 'trays', draft: '', activeRunId: null, selectionByUser: false,
        tasks: [...session.tasks, ...tasks], selectedTaskId: suggested?.id ?? tasks[0]?.id ?? session.selectedTaskId,
        dumps: [...session.dumps, { id: action.id, rawText: action.rawText, quick: action.quick, createdAt: action.now, detailStatus: 'pending' }],
        runs: session.runs.map(run => run.activeSince === null ? run : pauseRun(run, action.now)), updatedAt: action.now,
      }
    }
    case 'addTaskFromResearch': {
      const id = `research:${action.now}:${Math.random().toString(36).slice(2, 6)}`
      const task: DomiTask = {
        id, dumpId: id, title: action.title.trim(), tray: action.tray,
        done: false, doneAt: null, steps: [], order: 0, dependsOn: [], why: '',
      }
      return {
        ...session,
        tasks: [...session.tasks, task],
        selectedTaskId: id, // Optional: select the newly created task
        updatedAt: action.now,
      }
    }
    case 'detail': {
      const dump = session.dumps.find(item => item.id === action.dumpId)
      if (!dump || dump.detailStatus === 'done') return session
      const candidates = session.tasks.filter(task => task.dumpId === action.dumpId)
      const tasks = session.tasks.map(task => {
        if (task.dumpId !== action.dumpId) return task
        const ordered = action.detail.dependencyOrder.filter(item => matchTask(item.task, candidates)?.id === task.id)
        const decomposed = action.detail.microTasks.filter(item => matchTask(item.originalTask, candidates)?.id === task.id)
        const sequence = ordered.length === 1 ? ordered[0] : undefined
        const micro = decomposed.length === 1 ? decomposed[0] : undefined
        return {
          ...task, order: sequence?.step ?? task.order, why: sequence?.whyThisOrder ?? task.why,
          dependsOn: sequence?.dependsOn.map(title => matchTask(title, candidates)?.id).filter((id): id is string => Boolean(id) && id !== task.id) ?? task.dependsOn,
          // Existing user progress wins over any delayed model response.
          steps: task.steps.length || task.done ? task.steps : (micro?.atomicSteps.map((step, index) => ({ id: `${task.id}:step:${index}`, title: step.stepTitle, hook: step.actionableHook, minutes: step.durationMinutes, done: false })) ?? []),
        }
      })
      const proposed = tasks.filter(task => task.dumpId === action.dumpId && !task.done).sort((a, b) => a.order - b.order)[0]
      const latestDump = session.dumps[session.dumps.length - 1]?.id === action.dumpId
      return { ...session, tasks, dumps: session.dumps.map(item => item.id === action.dumpId ? { ...item, detailStatus: 'done' } : item), selectedTaskId: latestDump && !session.selectionByUser && session.screen !== 'dominio' ? proposed?.id ?? session.selectedTaskId : session.selectedTaskId }
    }
    case 'detailStatus': return { ...session, dumps: session.dumps.map(dump => dump.id === action.dumpId ? { ...dump, detailStatus: action.status } : dump) }
    case 'choose': return session.tasks.some(task => task.id === action.taskId && !task.done) ? { ...session, selectedTaskId: action.taskId, selectionByUser: true } : session
    case 'move': return { ...session, tasks: session.tasks.map(task => task.id === action.taskId ? { ...task, tray: action.tray } : task) }
    case 'step': return { ...session, tasks: session.tasks.map(task => task.id === action.taskId && !task.done ? { ...task, steps: task.steps.map(step => step.id === action.stepId ? { ...step, done: !step.done } : step) } : task) }
    case 'research': {
      const task = session.tasks.find(task => task.id === action.taskId)
      if (!task || !z.string().uuid().safeParse(action.runId).success) return session
      return { ...session, research: { runId: action.runId, tray: task.tray, title: task.title } }
    }
    case 'trayResearch': {
      if (!z.string().uuid().safeParse(action.runId).success) return session
      return { ...session, research: { runId: action.runId, tray: action.tray, title: action.title } }
    }
    case 'start': {
      if (!session.tasks.some(task => task.id === action.taskId && !task.done)) return session
      const oldRuns = session.runs.map(run => run.activeSince === null ? run : pauseRun(run, action.now))
      const previous = [...oldRuns].reverse().find(run => run.taskId === action.taskId && run.outcome === 'open')
      const run: FocusRun = previous ? { ...previous, activeSince: action.now, checkpointAt: action.now } : { id: action.runId, taskId: action.taskId, startedAt: action.now, activeSince: action.now, activeMs: 0, checkpointAt: action.now, endedAt: null, outcome: 'open' }
      return { ...session, screen: 'dominio', selectedTaskId: action.taskId, selectionByUser: true, activeRunId: run.id, runs: previous ? oldRuns.map(item => item.id === previous.id ? run : item) : [...oldRuns, run], updatedAt: action.now }
    }
    case 'clockVisible': return { ...session, clockVisible: !session.clockVisible }
    case 'screen':
    case 'leave':
    case 'pause':
    case 'resume':
    case 'stop':
    case 'finish':
    case 'checkpoint':
    case 'resetClock': {
      const current = activeRun(session)
      if (action.type === 'screen' || action.type === 'leave') {
        if (action.type === 'screen' && action.screen === 'research' && !session.research) return session
        return { ...session, screen: action.type === 'screen' ? action.screen : 'trays', activeRunId: null, runs: session.runs.map(run => run.activeSince === null ? run : pauseRun(run, action.now)), updatedAt: action.now }
      }
      if (!current || current.outcome !== 'open') return session
      let next: FocusRun = current
      if (action.type === 'checkpoint') next = { ...current, checkpointAt: action.now }
      if (action.type === 'pause') next = pauseRun(current, action.now)
      if (action.type === 'resume' && current.activeSince === null) next = { ...current, activeSince: action.now, checkpointAt: action.now }
      if (action.type === 'stop' || action.type === 'finish' || action.type === 'resetClock') {
        next = { ...pauseRun(current, action.now), outcome: action.type === 'finish' ? 'completed' : action.type === 'stop' ? 'stopped' : 'reset', endedAt: action.now }
      }
      let result: DomiSession = { ...session, runs: session.runs.map(run => run.id === next.id ? next : run), updatedAt: action.now }
      if (action.type === 'stop') result = { ...result, screen: 'trays', activeRunId: null }
      if (action.type === 'finish') result.tasks = result.tasks.map(task => task.id === current.taskId ? { ...task, done: true, doneAt: action.now } : task)
      if (action.type === 'resetClock') result = sessionReducer(result, { type: 'start', taskId: current.taskId, runId: action.runId, now: action.now })
      return result
    }
  }
}
