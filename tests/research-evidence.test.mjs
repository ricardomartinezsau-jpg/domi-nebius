import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asEvidence, groundGuide } from '../lib/research-evidence.ts'

const a='https://docs.example.com/static', b='https://docs.example.org/static'
const finding={round:1,question:'¿Qué comando necesita el sitio?',claim:'Resumen agregado: ejecutar build.',confidence:'strong',sources:[
  {url:a,name:'Documentación A',snippet:'Para el mismo plan y versión: el comando build es obligatorio.'},
  {url:b,name:'Documentación B',snippet:'Para el mismo plan y versión: no se admite ningún comando build.'},
]}
test('the evidence preserves conflicting excerpts per URL, not the repeated synthesis', () => {
  const evidence=JSON.parse(asEvidence([finding]))[0]
  assert.equal(evidence.searchSummary,finding.claim)
  assert.equal(evidence.sources[0].excerpt,finding.sources[0].snippet)
  assert.equal(evidence.sources[1].excerpt,finding.sources[1].snippet)
  assert.equal(evidence.confidence,undefined,'domain count must not be fed as proof of truth')
})
test('unsafe, invented and snippetless citations cannot back an actionable step', () => {
  const evidence=[{...finding,sources:[...finding.sources,{url:'javascript:alert(1)',name:'bad',snippet:'Do it'},{url:'https://example.net/no-excerpt',name:'Empty',snippet:null}]}]
  const output={steps:[
    {title:'Supported',detail:'Check the documentation',sourceUrls:[a,a]},
    {title:'Unsupported',detail:'Do not assert this',sourceUrls:['javascript:alert(1)','https://example.net/no-excerpt','https://invented.example/path']},
  ],unconfirmed:[]}
  const result=groundGuide(output,evidence,`A (${a}) y B (${b}) no coinciden sobre build.`)
  assert.equal(result.steps.length,1)
  assert.deepEqual(result.steps[0].sourceUrls,[a])
  assert.match(result.unconfirmed.join(' '),/Unsupported/)
  assert.match(result.disagreement,/no coinciden/)
  assert.equal(JSON.parse(asEvidence(evidence))[0].sources.some(s=>s.url.startsWith('javascript:')),false)
})
test('uncertainty found in the second round is preserved; no conflict is invented', () => {
  const output={steps:[{title:'Revisar',detail:'Leer',sourceUrls:[a]}],unconfirmed:[`Segunda búsqueda: ${a} y ${b} no coinciden; confirmar el plan.`]}
  const result=groundGuide(output,[finding,{...finding,round:2}],null)
  assert.deepEqual(result.unconfirmed,output.unconfirmed)
  assert.equal(result.disagreement,null)
})
