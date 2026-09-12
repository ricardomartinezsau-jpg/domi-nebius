import { NextResponse } from 'next/server'
import { aplicarCriterio, type SalidaCriterio } from '@/lib/criterio'

/**
 * Domi como capacidad MCP.
 *
 * El mismo criterio que aplica la aplicación web se expone aquí para que
 * cualquier agente compatible lo consulte. No es otra aplicación ni otro
 * despliegue: es una ruta más del servicio que ya existe, servida desde la
 * misma dirección pública.
 *
 * No hay inferencia aquí dentro. El agente que llama aporta la inteligencia
 * general; esto aporta el criterio, que es determinístico y se puede auditar
 * regla por regla. Por eso no necesita clave, no puede agotar cuota y no se
 * cae en una demostración en vivo.
 */
export const runtime = 'nodejs'

const VERSION_POR_DEFECTO = '2025-06-18'

const HERRAMIENTA = {
  name: 'domi_aplicar_criterio',
  description:
    'Aplica el criterio de Domi a una situación de sobrecarga, bloqueo o agotamiento. ' +
    'Úsala cuando la persona describa que tiene demasiadas cosas encima, que no sabe por dónde ' +
    'empezar, o ANTES de proponerle un plan de varios pasos: pásale tu propuesta y Domi la ' +
    'corrige. Devuelve qué está pasando de verdad, qué falta saber, qué no conviene asumir, un ' +
    'solo siguiente movimiento, y qué regla de cuidado aplicó. Es determinística: no es una ' +
    'segunda opinión de otro modelo, es un criterio que se puede auditar.',
  inputSchema: {
    type: 'object',
    properties: {
      situacion: {
        type: 'string',
        description: 'Lo que dijo la persona, en sus palabras. Sin resumir ni limpiar: el criterio lee señales que un resumen borra.',
      },
      contexto: {
        type: 'string',
        description: 'Lo que ya sabes de la persona y no está en la frase anterior.',
      },
      propuesta: {
        type: 'array',
        description: 'Lo que ibas a proponerle. Si lo mandas, Domi juzga y corrige tu propuesta en vez de partir de cero.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'La cosa a hacer.' },
            primer_movimiento: { type: 'string', description: 'El primer clic o movimiento físico concreto.' },
            pasos: { type: 'array', items: { type: 'string' }, description: 'Los pasos, si los desglosaste.' },
          },
          required: ['titulo'],
        },
      },
    },
    required: ['situacion'],
  },
} as const

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, authorization',
  'access-control-expose-headers': 'mcp-session-id',
}

/** El texto que el agente lee y presenta. La estructura va aparte. */
function comoTexto(r: SalidaCriterio): string {
  return [
    `ESTADO LEÍDO: ${r.estado_cognitivo}`,
    `QUÉ PASA: ${r.que_pasa}`,
    `QUÉ IMPORTA: ${r.que_importa}`,
    r.que_falta_saber.length ? `QUÉ FALTA SABER:\n- ${r.que_falta_saber.join('\n- ')}` : null,
    r.no_asumir.length ? `QUÉ NO ASUMIR:\n- ${r.no_asumir.join('\n- ')}` : null,
    `SIGUIENTE MOVIMIENTO: ${r.siguiente_movimiento || '(ninguno todavía)'}`,
    `BOTÓN: ${r.copy_boton}`,
    r.movimiento_utilizable ? null : 'AVISO: este movimiento no se puede usar tal cual. Reformúlalo respetando las reglas rotas y vuelve a consultarme.',
    `CRITERIO APLICADO: ${r.criterio_aplicado.resumen}`,
    ...r.criterio_aplicado.reglas.filter((x) => !x.cumple).map((x) => `  · ${x.regla}: ${x.detalle}`),
  ].filter(Boolean).join('\n\n')
}

type Mensaje = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }

function despachar(mensaje: Mensaje) {
  const { id, method, params } = mensaje
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

  if (method === 'initialize') {
    const pedida = params?.protocolVersion
    return ok({
      protocolVersion: typeof pedida === 'string' ? pedida : VERSION_POR_DEFECTO,
      capabilities: { tools: {} },
      serverInfo: { name: 'domi-criterio', version: '1.0.0' },
      instructions:
        'Domi aporta criterio, no inteligencia general. Cuando alguien describa sobrecarga o ' +
        'bloqueo, o antes de darle un plan de varios pasos, pásale la situación y tu propuesta ' +
        'a domi_aplicar_criterio y presenta lo que devuelva. Si Domi sustituye el arranque, di ' +
        'que lo hizo y por qué: esa corrección es el valor.',
    })
  }
  if (method === 'tools/list') return ok({ tools: [HERRAMIENTA] })
  if (method === 'tools/call') {
    if (params?.name !== HERRAMIENTA.name) return error(-32602, `Herramienta desconocida: ${String(params?.name)}`)
    const args = (params?.arguments ?? {}) as Record<string, unknown>
    if (typeof args.situacion !== 'string' || !args.situacion.trim()) {
      return ok({ isError: true, content: [{ type: 'text', text: 'Falta "situacion": lo que dijo la persona, en sus palabras.' }] })
    }
    const r = aplicarCriterio(args)
    return ok({ content: [{ type: 'text', text: comoTexto(r) }], structuredContent: r })
  }
  if (method === 'ping') return ok({})
  return error(-32601, `Método no implementado: ${String(method)}`)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/** Sonda: sirve para comprobar desde el navegador que la capacidad está viva. */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      servidor: 'domi-criterio',
      herramienta: HERRAMIENTA.name,
      transporte: 'JSON-RPC 2.0 por POST a esta misma dirección',
      inferencia: 'ninguna: el criterio es determinístico',
    },
    { headers: CORS },
  )
}

export async function POST(request: Request) {
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido.' } }, { status: 400, headers: CORS })
  }
  const esLote = Array.isArray(cuerpo)
  const entradas = (esLote ? cuerpo : [cuerpo]) as Mensaje[]
  // Una notificación no lleva id y no espera respuesta.
  const salidas = entradas.filter((m) => m && m.id !== undefined && m.id !== null).map(despachar)
  if (salidas.length === 0) return new NextResponse(null, { status: 202, headers: CORS })
  return NextResponse.json(esLote ? salidas : salidas[0], { headers: CORS })
}
