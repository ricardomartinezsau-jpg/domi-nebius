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
  console.error('[workflows] promesa sin capturar:', reason instanceof Error ? reason.message : reason)
})

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
