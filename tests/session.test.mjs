import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeRun, elapsedMs, emptySession, matchTask, restoreSession, sessionReducer as reduce } from '../lib/session.ts'

const quick = {
  trayDispatch: { profesionalProductiva: ['Enviar propuesta', 'Revisar números'], personalBienestar: ['Caminar'], familiarDomestica: ['Pagar la luz'], socialComunitaria: [] },
  momentumMode: { activationHook: 'Abre el borrador', cognitiveLoadLevel: 'media', antiDopamineTraps: [], singleFocusShield: 'Deja el correo cerrado.' },
}
const detail = {
  dependencyOrder: [{ step: 1, task: 'Revisar números', dependsOn: [], whyThisOrder: 'La propuesta necesita cifras revisadas.' }, { step: 2, task: 'Enviar propuesta', dependsOn: ['Revisar números'], whyThisOrder: 'Después de revisar.' }],
  microTasks: [{ originalTask: 'Enviar propuesta', atomicSteps: [{ stepTitle: 'Abrir borrador', durationMinutes: 2, actionableHook: 'Abre el archivo actual.' }] }],
}
const begin = () => reduce(emptySession(), { type: 'quick', id: 'dump-1', rawText: 'Propuesta, números, caminar y luz', quick, now: 1000 })
const start = (s, time = 2000) => reduce(s, { type: 'start', taskId: s.selectedTaskId, runId: 'run-1', now: time })

test('an API retry cannot duplicate a dump; a later dump preserves previous work', () => {
  const initial = begin()
  assert.equal(initial.tasks.length, 4)
  const repeated = reduce(initial, { type: 'quick', id: 'dump-1', rawText: '', quick, now: 2000 })
  assert.equal(repeated, initial)
  const finished = reduce(start(initial), { type: 'finish', now: 5000 })
  const next = reduce(finished, { type: 'quick', id: 'dump-2', rawText: 'otro vaciado', quick, now: 7000 })
  assert.equal(next.tasks.length, 8)
  assert.equal(next.tasks[0].done, true)
  assert.equal(next.runs.length, 1)
})

test('delayed detail must preserve the chosen task, corrected tray, active clock and steps', () => {
  let s = begin()
  const chosen = s.tasks[0].id
  s = reduce(s, { type: 'move', taskId: chosen, tray: 'familiarDomestica' })
  s = start(s)
  s = reduce(s, { type: 'detail', dumpId: 'dump-1', detail })
  assert.equal(s.selectedTaskId, chosen)
  assert.equal(s.tasks[0].tray, 'familiarDomestica')
  assert.equal(activeRun(s).activeSince, 2000)
  assert.equal(s.tasks[0].dependsOn[0], s.tasks[1].id)
  s = reduce(s, { type: 'step', taskId: chosen, stepId: s.tasks[0].steps[0].id })
  s = reduce(s, { type: 'detail', dumpId: 'dump-1', detail })
  assert.equal(s.tasks[0].steps[0].done, true)
  assert.equal(s.tasks[0].done, false)
})

test('old detail cannot steal selection from a more recent dump', () => {
  let s = reduce(begin(), { type: 'quick', id: 'dump-2', rawText: 'nuevos', quick, now: 2000 })
  const selected = s.selectedTaskId
  s = reduce(s, { type: 'detail', dumpId: 'dump-1', detail })
  assert.equal(s.selectedTaskId, selected)
})

test('timer measures clock deltas, excludes pauses, and hiding it never stops it', () => {
  let s = start(begin())
  s = reduce(s, { type: 'clockVisible' })
  assert.equal(elapsedMs(activeRun(s), 12_000), 10_000)
  s = reduce(s, { type: 'pause', now: 12_000 })
  assert.equal(elapsedMs(activeRun(s), 90_000), 10_000)
  s = reduce(s, { type: 'resume', now: 100_000 })
  assert.equal(elapsedMs(activeRun(s), 105_000), 15_000)
  s = reduce(s, { type: 'finish', now: 105_000 })
  assert.equal(activeRun(s).activeMs, 15_000)
  assert.equal(reduce(s, { type: 'finish', now: 200_000 }), s)
})

test('reload restores a paused run at its last checkpoint, preserving the same task', () => {
  let s = start(begin())
  s = reduce(s, { type: 'checkpoint', now: 7000 })
  const restored = restoreSession(JSON.stringify(s))
  assert.equal(restored.screen, 'dominio')
  assert.equal(restored.selectedTaskId, s.selectedTaskId)
  assert.equal(activeRun(restored).activeSince, null)
  assert.equal(elapsedMs(activeRun(restored), 500_000), 5000)
  assert.equal(restored.dumps[0].detailStatus, 'failed')
})

test('leaving and returning reuses the paused run; a reset preserves its prior measured time', () => {
  let s = start(begin())
  s = reduce(s, { type: 'leave', now: 7000 })
  assert.equal(s.screen, 'trays')
  s = reduce(s, { type: 'start', taskId: s.selectedTaskId, runId: 'not-used', now: 10_000 })
  assert.equal(s.runs.length, 1)
  s = reduce(s, { type: 'resetClock', runId: 'run-2', now: 12_000 })
  assert.equal(s.runs[0].activeMs, 7000)
  assert.equal(s.runs[0].outcome, 'reset')
  assert.equal(activeRun(s).activeMs, 0)
  s = reduce(s, { type: 'stop', now: 15_000 })
  assert.equal(s.tasks[0].done, false)
  assert.equal(s.runs[1].outcome, 'stopped')
})

test('ambiguous titles do not invent a relation; broken stored references are rejected', () => {
  const s = begin()
  assert.equal(matchTask('enviar propuesta', s.tasks).id, s.tasks[0].id)
  assert.equal(matchTask('Pagar la propuesta', s.tasks), undefined)
  assert.equal(matchTask('Enviar propuesta', [s.tasks[0], { ...s.tasks[0], id: 'duplicate' }]), undefined)
  assert.equal(restoreSession('{broken'), null)
  assert.equal(restoreSession(JSON.stringify({ ...s, selectedTaskId: 'missing' })), null)
})

test('research is session-owned, remains version 1 and survives moving/finishing its task', () => {
  const id='29ff3b1c-7483-4cbf-9a5b-3ef87be7fb9a'
  let s=begin()
  assert.ok(restoreSession(JSON.stringify(s)), 'old v1 without research still loads')
  s=reduce(s,{type:'research',taskId:s.selectedTaskId,runId:id})
  assert.equal(s.tasks[0].researchRunId,undefined)
  const reference=s.research
  s=reduce(s,{type:'move',taskId:s.selectedTaskId,tray:'socialComunitaria'})
  s=reduce(start(s),{type:'finish',now:5000})
  s=reduce(s,{type:'screen',screen:'research',now:6000})
  const restored=restoreSession(JSON.stringify(s))
  assert.equal(restored.version,1)
  assert.equal(restored.screen,'research')
  assert.deepEqual(restored.research,reference)
  assert.equal(restored.research.runId,id)
})

test('legacy task research is promoted to session and a missing research screen has a safe return', () => {
  const s=begin()
  s.tasks[0].researchRunId='29ff3b1c-7483-4cbf-9a5b-3ef87be7fb9a'
  assert.equal(restoreSession(JSON.stringify(s)).research.runId,s.tasks[0].researchRunId)
  assert.equal(restoreSession(JSON.stringify({...begin(),screen:'research'})).screen,'trays')
})
