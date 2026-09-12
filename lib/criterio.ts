/**
 * El criterio de Domi. Reglas determinísticas, sin modelo y sin red.
 *
 * Copiado y recortado del proyecto anterior, y ampliado con el andamiaje
 * cognitivo del prototipo: cero deuda, tono sin urgencia impuesta, primer
 * movimiento mecánico y lectura del estado.
 *
 * La tesis en una línea: un prompt es una sugerencia, un criterio es una
 * garantía. El host aporta la inteligencia general; esto aporta el criterio.
 *
 * Lo que esto NO hace: diagnosticar. `estado_cognitivo` es una lectura de
 * señales en el texto, no una etiqueta clínica sobre una persona. Cuando no
 * hay señal clara lo dice, en vez de forzar una clasificación.
 */


export type Estado = 'colapso_fisico' | 'sobrecarga' | 'bloqueo_iniciacion' | 'friccion_evitacion' | 'sin_senal_clara'
export type Regla = { regla: string; cumple: boolean; detalle: string }
export type Movimiento = { titulo: string; primer_movimiento: string; pasos: string[] }
export type EntradaCriterio = { situacion?: string; contexto?: string; propuesta?: unknown }
export type SalidaCriterio = {
  estado_cognitivo: Estado
  que_pasa: string
  que_importa: string
  que_falta_saber: string[]
  no_asumir: string[]
  siguiente_movimiento: string
  movimiento_utilizable: boolean
  copy_boton: string
  propuesta_corregida: Movimiento[]
  criterio_aplicado: { reglas: Regla[]; rotas: string[]; arranque_sustituido: boolean; resumen: string }
}

/** Señales de que el cuerpo de la persona está en crisis, no sólo su agenda. */
const SENALES_DE_COLAPSO = [
  'no puedo respirar', 'me cuesta respirar', 'pecho apretado', 'parálisis total',
  'paralisis total', 'ataque de pánico', 'ataque de panico', 'colapso', 'no doy más',
  'no doy mas', 'taquicardia', 'me tiembla', 'días sin dormir', 'dias sin dormir',
  "can't breathe", 'panic attack', 'shutting down',
]

/** Demandas simultáneas que saturan la memoria de trabajo. */
const SENALES_DE_SOBRECARGA = [
  'mil cosas', 'todo a la vez', 'no me da la vida', 'me satura', 'demasiadas cosas',
  'no doy abasto', 'se me acumul', 'todo junto', 'por todos lados', 'overwhelmed',
]

/** Sabe qué hacer y no puede arrancar. */
const SENALES_DE_BLOQUEO = [
  'no sé por dónde empezar', 'no se por donde empezar', 'no puedo arrancar',
  'me quedo mirando', 'dándole vueltas', 'dandole vueltas', 'me trabo',
  'me quedo en blanco', "can't get started", 'staring at',
]

/** Pospone por aversión, no por falta de claridad. */
const SENALES_DE_EVITACION = [
  'lo dejo para', 'lo he ido dejando', 'posponiendo', 'me da pereza',
  'no me apetece', 'lo evito', 'siempre lo aplazo', 'procrastin', 'putting it off',
]

/** Acciones que regulan el sistema nervioso antes de exigirle algo. */
const ACCIONES_QUE_REGULAN = [
  'respir', 'agua', 'caminar', 'camina', 'estirar', 'sal a', 'salir a', 'sal al',
  'aire', 'pausa', 'acost', 'siéntate', 'sientate', 'breath', 'water', 'walk', 'stretch',
]

/**
 * Verbos que abren una acción mecánica: se hace sin decidir nada y da
 * recompensa inmediata. Un primer movimiento tiene que empezar por uno de estos.
 */
const VERBOS_MECANICOS = [
  'abre', 'escribe', 'manda', 'envía', 'envia', 'copia', 'pega', 'busca', 'pon',
  'marca', 'llama', 'apunta', 'descarga', 'guarda', 'contesta', 'responde',
  'saca', 'toma', 'teclea', 'dile', 'cierra', 'borra', 'sube', 'imprime',
  'sal ', 'levántate', 'levantate', 'bebe', 'respira',
]

/**
 * Verbos que piden esfuerzo mental sostenido. No sirven como primer movimiento:
 * son justo lo que una cabeza saturada evita.
 */
const VERBOS_DE_ANALISIS = [
  'analiza', 'evalúa', 'evalua', 'revisa', 'compara', 'investiga', 'planifica',
  'define', 'piensa', 'decide', 'organiza', 'prioriza', 'reflexiona',
  'estudia', 'valora', 'determina',
]

/** Lenguaje que impone urgencia o culpa. Prohibido, sin excepciones. */
const TONO_PROHIBIDO = [
  'deberías', 'deberias', 'debería', 'deberia', 'urgente', 'tienes que', 'tenés que',
  'tenes que', 'hay que', 'cuanto antes', 'ya mismo', 'no puedes seguir',
  'sin excusas', 'ponte las pilas', 'asap',
]

/** Prefijos de urgencia que se le quitan al arranque: es texto sobrante. */
const PREFIJOS_IMPUESTOS = [
  'deberías', 'deberias', 'debería', 'deberia', 'tienes que', 'tenés que', 'tenes que',
  'hay que', 'urgente:', 'urgente', 'ya mismo', 'cuanto antes',
]

/** Sustantivos de deuda: contar lo que va con ellos convierte el día en una nota. */
const SUSTANTIVOS_DE_DEUDA = [
  'mensaje', 'correo', 'tarea', 'pendiente', 'cosa', 'día', 'dia', 'semana', 'email',
]

/** El texto fijo de emergencia. Existe para no depender de que un modelo acierte. */
export const ARRANQUE_SEGURO =
  'Antes de nada: tres respiraciones lentas y un vaso de agua. Lo demás sigue ahí en cinco minutos.'

export const TOPE_COSAS = 3
export const TOPE_PASOS = 5
export const TOPE_CARACTERES = 140
export const TOPE_PALABRAS_BOTON = 3

/**
 * Todo se compara como texto, no con expresiones regulares. Es más lento y da
 * igual: se gana que ningún escapado pueda corromper una regla en silencio, que
 * es exactamente el tipo de fallo que este proyecto existe para evitar.
 */
const bajo = (t: unknown): string => (typeof t === 'string' ? t.toLowerCase().trim() : '')
const contiene = (t: unknown, lista: readonly string[]): boolean => lista.some((v) => bajo(t).includes(v))
const empiezaPor = (t: unknown, lista: readonly string[]): boolean => lista.some((v) => bajo(t).startsWith(v))
const limpio = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const pideAnalisis = (t: string): boolean => contiene(t, VERBOS_DE_ANALISIS)
const arrancaMecanico = (t: string): boolean => empiezaPor(t, VERBOS_MECANICOS)

/** Un número pegado a un sustantivo de deuda, en una ventana de tres palabras. */
export function cuentaLoAtrasado(texto: string): boolean {
  const palabras = bajo(texto).split(/[^a-zá-úñ0-9]+/i).filter(Boolean)
  for (let i = 0; i < palabras.length; i++) {
    if (!/^\d+$/.test(palabras[i])) continue
    for (let j = i + 1; j <= Math.min(i + 3, palabras.length - 1); j++) {
      if (SUSTANTIVOS_DE_DEUDA.some((s) => palabras[j].startsWith(s))) return true
    }
  }
  return false
}

/** Quita el arranque impuesto: "Deberías abre…" se queda en "abre…". Mecánico y seguro. */
export function quitarUrgencia(texto: string): string {
  let t = limpio(texto)
  for (const p of PREFIJOS_IMPUESTOS) {
    if (bajo(t).startsWith(p)) {
      t = t.slice(p.length).replace(/^[\s,:]+/, '')
      break
    }
  }
  return t.trim()
}

/**
 * Lectura del estado a partir de señales en el texto. Cuatro estados, en orden
 * de precedencia: el cuerpo manda sobre todo lo demás.
 *
 * Si no hay señal, devuelve `sin_senal_clara`. Forzar una clasificación para
 * que el hueco no quede vacío es exactamente lo que este proyecto no hace.
 */
export function leerEstado(texto: string, cuantasCosas = 0): Estado {
  if (contiene(texto, SENALES_DE_COLAPSO)) return 'colapso_fisico'
  if (contiene(texto, SENALES_DE_SOBRECARGA) || cuantasCosas > TOPE_COSAS) return 'sobrecarga'
  if (contiene(texto, SENALES_DE_BLOQUEO)) return 'bloqueo_iniciacion'
  if (contiene(texto, SENALES_DE_EVITACION)) return 'friccion_evitacion'
  return 'sin_senal_clara'
}

const QUE_PASA: Record<Estado, string> = {
  colapso_fisico: 'Esto no es sólo una agenda cargada: hay señales de que el cuerpo está en crisis. Mientras eso siga así, cualquier plan de trabajo va a rebotar.',
  sobrecarga: 'Hay más demandas a la vez de las que caben en una cabeza, y ninguna elegida. El problema no es la falta de un plan: es que no hay hueco para pensarlo.',
  bloqueo_iniciacion: 'Sabe qué hay que hacer. Lo que no puede es arrancar, y cada minuto mirando la pantalla lo confirma.',
  friccion_evitacion: 'No es falta de claridad: es que la recompensa está demasiado lejos y arrancar cuesta más de lo que da.',
  sin_senal_clara: 'No hay señales suficientes para leer el estado. Mejor preguntar que suponerlo.',
}

/**
 * Aplica el criterio a la situación y a lo que el host iba a proponer.
 * Devuelve la propuesta corregida y, sobre todo, qué regla se aplicó y por qué.
 */
export function aplicarCriterio({ situacion = '', contexto = '', propuesta = [] }: EntradaCriterio = {}): SalidaCriterio {
  const texto = `${limpio(situacion)}\n${limpio(contexto)}`
  const reglas: Regla[] = []
  const anota = (id: string, cumple: boolean, detalle: string) => { reglas.push({ regla: id, cumple, detalle }); return cumple }

  const entrada: Movimiento[] = (Array.isArray(propuesta) ? propuesta : [])
    .map((item: Record<string, unknown>) => ({
      titulo: limpio(item?.titulo),
      primer_movimiento: limpio(item?.primer_movimiento),
      pasos: Array.isArray(item?.pasos) ? item.pasos.map(limpio).filter(Boolean) : [],
    }))
    .filter((item) => item.titulo || item.primer_movimiento)

  const estado = leerEstado(texto, entrada.length)
  const hayColapso = estado === 'colapso_fisico'
  const primero = entrada[0]
  // Se le quita el prefijo de urgencia antes de nada: es texto sobrante que la
  // persona no tiene por qué leer, y quitarlo es mecánico y seguro.
  const arranquePropuesto = quitarUrgencia(primero?.primer_movimiento || primero?.titulo || '')

  // 1. Anulación por colapso. La única regla que sustituye en vez de corregir.
  let siguiente_movimiento = arranquePropuesto
  let arranque_sustituido = false
  if (hayColapso) {
    const regulaElCuerpo = contiene(arranquePropuesto, ACCIONES_QUE_REGULAN)
    anota('anulacion-por-colapso', regulaElCuerpo,
      regulaElCuerpo
        ? 'Hay señales de colapso físico y el arranque propuesto ya regula el cuerpo.'
        : 'Hay señales de colapso físico: el primer movimiento no puede ser producir. Se sustituye.')
    if (!regulaElCuerpo) { siguiente_movimiento = ARRANQUE_SEGURO; arranque_sustituido = true }
  }

  // 2. Un arranque es una sola acción y cabe en una línea.
  const cabe = siguiente_movimiento.length > 0 && siguiente_movimiento.length <= TOPE_CARACTERES
  anota('arranque-de-una-linea', cabe,
    !siguiente_movimiento ? 'No hay ningún primer movimiento que ofrecer.'
      : cabe ? `El arranque cabe en ${TOPE_CARACTERES} caracteres.`
      : `El arranque tiene ${siguiente_movimiento.length} caracteres: por encima de ${TOPE_CARACTERES} deja de ser un primer movimiento y es un proyecto disfrazado.`)
  if (!cabe && siguiente_movimiento.length > TOPE_CARACTERES) {
    siguiente_movimiento = `${siguiente_movimiento.slice(0, TOPE_CARACTERES - 1).trimEnd()}…`
  }

  // 3. El primer movimiento es mecánico, no analítico. La regla de los dos
  //    minutos: se hace sin decidir nada, y da recompensa al terminarlo.
  const esAnalitico = pideAnalisis(siguiente_movimiento)
  const esMecanico = arrancaMecanico(siguiente_movimiento)
  anota('primer-movimiento-mecanico', esMecanico || !esAnalitico,
    esAnalitico && !esMecanico
      ? 'El arranque pide esfuerzo mental sostenido («analiza», «revisa», «decide»). Eso es justo lo que una cabeza saturada evita. Tiene que ser una acción mecánica: abrir, escribir, mandar.'
      : esMecanico ? 'El arranque es una acción mecánica que se completa en un par de minutos.'
      : 'El arranque no pide análisis, aunque tampoco empieza por un verbo mecánico claro.')

  // 4. Techo de descomposición: tres cosas, cinco pasos cada una.
  const dentroDelTope = entrada.length <= TOPE_COSAS
  anota('techo-de-cosas', dentroDelTope,
    dentroDelTope ? `${entrada.length} cosa(s) propuesta(s), dentro del tope de ${TOPE_COSAS}.`
      : `Se proponían ${entrada.length} cosas y el tope es ${TOPE_COSAS}. Más de eso reproduce la avalancha de la que la persona venía huyendo. Se recorta.`)
  const desbordadas = entrada.filter((i) => i.pasos.length > TOPE_PASOS).length
  anota('techo-de-pasos', desbordadas === 0,
    desbordadas === 0 ? `Ninguna cosa pasa de ${TOPE_PASOS} pasos.`
      : `${desbordadas} cosa(s) traían más de ${TOPE_PASOS} pasos. Se recortan: hacerlo más pequeño acerca el siguiente movimiento, no alarga la lista.`)

  const corregida = entrada.slice(0, TOPE_COSAS).map((i) => ({ ...i, pasos: i.pasos.slice(0, TOPE_PASOS) }))

  // 5. Cada primer movimiento es concreto.
  const vagas: string[] = corregida.filter((i) => i.primer_movimiento.length > 0 && i.primer_movimiento.length < 10).map((i) => i.titulo)
  anota('primer-movimiento-concreto', vagas.length === 0,
    vagas.length === 0 ? 'Cada cosa trae un primer movimiento concreto.'
      : `Sin un primer movimiento concreto: ${vagas.join(', ')}. Lo abstracto es justo lo que paraliza.`)

  const visible = [siguiente_movimiento, ...corregida.flatMap((i) => [i.titulo, i.primer_movimiento, ...i.pasos])].filter(Boolean)

  // 6. Cero deuda: no se cuantifica lo atrasado. Nunca.
  const cuenta = visible.find((t) => cuentaLoAtrasado(t))
  anota('cero-deuda', !cuenta,
    cuenta ? `Se está contando lo atrasado («${cuenta.slice(0, 60)}»). Un número junto a lo pendiente convierte el día en una nota, y esa nota es la que paraliza.`
      : 'No se cuantifica nada atrasado.')

  // 7. Tono: sin urgencia impuesta ni culpa.
  const impuesto = visible.find((t) => contiene(t, TONO_PROHIBIDO))
  anota('sin-urgencia-impuesta', !impuesto,
    impuesto ? `Hay urgencia o culpa impuesta en el texto («${impuesto.slice(0, 60)}»). Nada de «deberías», «tienes que» ni «urgente»: la presión ya la pone la persona sola.`
      : 'El tono es descriptivo, sin urgencia añadida.')

  // 8. Higiene del texto que la persona lee.
  anota('no-se-grita', !visible.some((t) => /\b[A-ZÁÉÍÓÚÑ]{4,}\b/.test(t)),
    'Nada en mayúsculas sostenidas: a alguien saturado le suena a grito.')
  anota('sin-marcas-de-formato', !visible.some((t) => /\*|_{2,}|#{1,6}\s/.test(t)),
    'El texto se lee tal cual, sin asteriscos ni marcas a medio interpretar.')

  const rotas = reglas.filter((r) => !r.cumple)
  const idsRotas = rotas.map((r) => r.regla)

  return {
    estado_cognitivo: estado,
    que_pasa: QUE_PASA[estado],
    que_importa: corregida[0]
      ? `Hoy sólo importa esto: ${corregida[0].titulo || siguiente_movimiento}`
      : 'Todavía no hay una sola cosa elegida.',
    que_falta_saber: [
      hayColapso ? '¿Cuánto lleva así? Sin eso no se sabe si esto es un mal día o algo sostenido.' : null,
      estado === 'sin_senal_clara' ? 'Cómo está llevando esto, con sus palabras. Sin eso, cualquier lectura es una suposición.' : null,
      estado === 'friccion_evitacion' ? 'Qué es lo desagradable de esa tarea en concreto. Se evita algo, no todo.' : null,
      entrada.length === 0 ? 'Qué se comprometió con otras personas y qué se puso sola.' : null,
      entrada.length > TOPE_COSAS ? 'Cuál de todas tiene una fecha real y cuál sólo se siente urgente.' : null,
      vagas.length ? 'Qué es exactamente el primer clic de lo que quedó en abstracto.' : null,
    ].filter((x): x is string => Boolean(x)),
    no_asumir: [
      hayColapso ? 'No asumas que puede empezar produciendo. Ahora mismo no puede, y pedírselo confirma que el problema es su falta de voluntad.' : null,
      estado === 'sobrecarga' ? 'No asumas que ver la lista completa la va a tranquilizar. La lista completa es el problema.' : null,
      estado === 'bloqueo_iniciacion' ? 'No asumas que le falta información. Ya sabe qué hacer; lo que falta es el primer movimiento, no otro plan.' : null,
      estado === 'friccion_evitacion' ? 'No asumas que es falta de disciplina. Lo que falla es la distancia hasta la recompensa, y eso se arregla acortándola.' : null,
      estado === 'sin_senal_clara' ? 'No asumas un estado que no dijo. Pregunta antes de aplicar criterio sobre una suposición.' : null,
      'No asumas que quiere un plan. Puede que sólo necesite saber cuál es el siguiente paso.',
    ].filter((x): x is string => Boolean(x)),
    siguiente_movimiento,
    // Hay roturas que Domi no puede arreglar solo sin inventarse el contenido.
    // Cuando pasa, lo dice: el host tiene que reformular, no publicar esto.
    movimiento_utilizable: !idsRotas.includes('cero-deuda') && !idsRotas.includes('primer-movimiento-mecanico'),
    copy_boton: botonDe(siguiente_movimiento),
    propuesta_corregida: corregida,
    criterio_aplicado: {
      reglas,
      rotas: idsRotas,
      arranque_sustituido,
      resumen: rotas.length === 0
        ? 'La propuesta pasa el criterio de Domi sin cambios.'
        : `Domi corrigió la propuesta: ${idsRotas.join(', ')}.`,
    },
  }
}

/** Texto del botón de acción: tres palabras como mucho, y en imperativo suave. */
export function botonDe(movimiento: string): string {
  if (!movimiento) return 'Empezar'
  if (movimiento === ARRANQUE_SEGURO) return 'Respirar primero'
  const palabras = movimiento.replace(/[.,;:!?…]/g, ' ').split(/\s+/).filter(Boolean)
  return palabras.slice(0, TOPE_PALABRAS_BOTON).join(' ') || 'Empezar'
}
