import assert from 'node:assert/strict'
import { test } from 'node:test'
import { observeResearch } from '../lib/research-observer.ts'

const id = '29ff3b1c-7483-4cbf-9a5b-3ef87be7fb9a'
const flush = async () => { for (let i=0; i<8; i++) await Promise.resolve() }
function setup(t) {
  const previous = { document: globalThis.document, window: globalThis.window }
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  globalThis.window = new EventTarget()
  t.after(() => Object.assign(globalThis, previous))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = [], views = [], errors = []
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({url, options, resolve})))
  const stop = observeResearch(id, view => views.push(view), error => errors.push(error))
  t.after(stop)
  const reply = async (index, status='running') => { requests[index].resolve({ok:true,json:async()=>({runId:id,status})}); await flush() }
  return {requests,views,errors,stop,reply}
}

test('unmount during await aborts and a late response cannot resurrect polling', async t => {
  const s=setup(t)
  s.stop()
  assert.equal(s.requests[0].options.signal.aborted,true)
  await s.reply(0)
  t.mock.timers.tick(60000)
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pageshow'))
  await flush()
  assert.equal(s.requests.length,1)
  assert.equal(s.views.length,0)
  assert.equal(s.errors.length,0)
})

test('hidden phone cancels work; returning rereads immediately without waiting for a timer', async t => {
  const s=setup(t)
  document.visibilityState='hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(s.requests[0].options.signal.aborted,true)
  t.mock.timers.tick(120000)
  assert.equal(s.requests.length,1)
  document.visibilityState='visible'
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('pageshow'))
  assert.equal(s.requests.length,2, 'two wake events share one request')
  await s.reply(1,'done')
  await s.reply(0,'running')
  assert.deepEqual(s.views.map(v=>v.status),['done'])
  t.mock.timers.tick(60000)
  assert.equal(s.requests.length,2, 'terminal state stops polling')
})

test('BFCache pageshow recovers by id and cleanup cancels a scheduled poll', async t => {
  const s=setup(t)
  await s.reply(0)
  window.dispatchEvent(new Event('pagehide'))
  t.mock.timers.tick(60000)
  assert.equal(s.requests.length,1)
  window.dispatchEvent(new Event('pageshow'))
  assert.equal(s.requests.length,2)
  assert.equal(s.requests[1].url,`/api/research?runId=${id}`)
  assert.equal(s.requests[1].options.method,undefined,'recovery only reads, never POSTs')
  await s.reply(1)
  s.stop()
  t.mock.timers.tick(60000)
  assert.equal(s.requests.length,2)
})

test('transient read failure recovers, and failed research stops periodic reads', async t => {
  const s=setup(t)
  s.requests[0].resolve({ok:false,status:503})
  await flush()
  assert.match(s.errors[0],/actualizar/)
  t.mock.timers.tick(2500)
  await s.reply(1,'failed')
  assert.equal(s.errors.at(-1),null)
  t.mock.timers.tick(60000)
  assert.equal(s.requests.length,2)
})

test('lost ownership stops polling, including wake events', async t => {
  const s = setup(t)
  s.requests[0].resolve({ ok: false, status: 404 })
  await flush()
  t.mock.timers.tick(120000)
  window.dispatchEvent(new Event('pageshow'))
  document.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(s.requests.length, 1)
  assert.match(s.errors[0], /sesión/)
})
