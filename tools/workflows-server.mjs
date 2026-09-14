// Copyright (c) 2026 Domi Nebius. Todos los derechos reservados.
// Queda prohibida la reproducción, modificación o distribución no autorizada de este código.

/**
 * Arranque del servicio de Render Workflows.
 *
 * Existe porque el `npm start` de este repositorio levanta Next.js, y un
 * servicio de Workflows que arrancara con eso parecería sano —la web responde—
 * pero no registraría ni una tarea: los archivos de `lib/workflows.ts` solo se
 * cargan en Next cuando alguien pide la ruta, y en el servicio de Workflows no
 * hay nadie pidiendo rutas.
 *
 * Aquí solo se importa el módulo que declara las tareas. El SDK levanta el
 * servidor de tareas por su cuenta al detectar que corre dentro de un entorno
 * de workflow (la variable RENDER_SDK_SOCKET_PATH); no hay que llamarlo.
 *
 * Comando de arranque del servicio en Render:  npm run start:workflows
 */
import './../lib/workflows.ts'
import { logFailure, withContext } from '../lib/operations.ts'

/**
 * Render arranca este proceso dos veces con propósitos distintos: primero para
 * registrar las tareas y después para ejecutarlas, y no en las dos pasa lo
 * mismo por el entorno. Por eso no se mira una sola variable: basta cualquier
 * señal de estar dentro de Render para no irse. Salirse durante el registro
 * dejaría el servicio sin una sola tarea declarada.
 */
const onRender = Boolean(
  process.env.RENDER_SDK_SOCKET_PATH || process.env.RENDER_SDK_MODE || process.env.RENDER_SERVICE_ID || process.env.RENDER,
)

console.log(
  `[workflows] tareas declaradas · en Render: ${onRender ? 'sí' : 'no'}` +
    `${process.env.RENDER_SDK_MODE ? ` · modo ${process.env.RENDER_SDK_MODE}` : ''} · ` +
    `modelo de investigación: ${process.env.NEBIUS_RESEARCH_MODEL?.trim() || 'openai/gpt-oss-120b (por defecto)'}`,
)

// Una promesa suelta no puede tumbar el servicio entero.
process.on('unhandledRejection', (reason) => {
  logFailure('workflow.unhandled_rejection', reason)
})

/**
 * ¿Alcanza este proceso la base de datos? En el arranque, no 120 segundos
 * después y dentro de una ejecución.
 *
 * La corrida del 12 de septiembre de 2026 terminó «completada» sin escribir
 * una sola fila: el trabajador no consiguió su primera escritura y nada lo
 * dijo. Este servicio se crea a mano en el panel de Render y sus variables se
 * pegan a mano —el blueprint no puede declararlas—, así que una dirección
 * ausente o vieja aquí es invisible. Esta línea la hace visible.
 *
 * No bloquea el registro de tareas: se lanza suelta, con su propio límite de
 * tiempo, y sólo escribe en el log. Nunca imprime la contraseña.
 */
function probeDatabase() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    console.error('[workflows] base de datos: NO HAY DATABASE_URL. Este servicio no puede escribir ni un hallazgo.')
    return
  }
  let where = 'destino ilegible'
  try {
    const parsed = new URL(url)
    where = `${parsed.host}${parsed.pathname}`
  } catch {}
  const ssl = process.env.DATABASE_SSL === 'require' ? 'require' : 'sin TLS'
  const started = Date.now()
  Promise.race([
    import('./../lib/db.ts').then(({ query }) => query('SELECT 1')),
    new Promise((_, reject) => setTimeout(() => reject(new Error('no respondió en 15 s')), 15_000)),
  ]).then(
    () => console.log(`[workflows] base de datos: alcanzable en ${Date.now() - started} ms · ${where} · ${ssl}`),
    // Mantiene el saneamiento central: sólo este diagnóstico añade el destino
    // ya sanitizado y el modo TLS; nunca URL, usuario, contraseña o mensaje.
    (error) => withContext({ databaseTarget: where, databaseTls: ssl }, () => logFailure('workflow.db_probe', error, Date.now() - started)),
  )
}

probeDatabase()

if (onRender) {
  // El SDK levanta su servidor de tareas y mantiene el proceso vivo. Este
  // temporizador es el cinturón: si por lo que sea no lo levantara, el proceso
  // se quedaría igualmente en pie, registrado, en vez de morir y hacer creer a
  // Render que el arranque falló.
  setInterval(() => {}, 1 << 30)
} else {
  console.log('[workflows] fuera de Render. Para probarlo en local: render workflows dev -- npm run start:workflows')
  process.exit(0)
}
