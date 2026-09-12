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

const inWorkflowEnv = Boolean(process.env.RENDER_SDK_SOCKET_PATH)

console.log(
  `[workflows] tareas declaradas · entorno de workflow: ${inWorkflowEnv ? 'sí' : 'no'} · ` +
    `modelo de investigación: ${process.env.NEBIUS_RESEARCH_MODEL?.trim() || 'openai/gpt-oss-120b (por defecto)'}`,
)

if (!inWorkflowEnv) {
  // Fuera de Render esto no puede ejecutar nada: sin el servidor de tareas el
  // proceso se quedaría vivo sin hacer nada, que es peor que decirlo y salir.
  console.log('[workflows] fuera de un entorno de Render Workflows. Para probar en local: render workflows dev -- npm run start:workflows')
  process.exit(0)
}

// Dentro de Render el SDK mantiene el proceso vivo atendiendo tareas. Este
// manejador solo evita que una promesa suelta tumbe el servicio entero.
process.on('unhandledRejection', (reason) => {
  console.error('[workflows] promesa sin capturar:', reason instanceof Error ? reason.message : reason)
})
