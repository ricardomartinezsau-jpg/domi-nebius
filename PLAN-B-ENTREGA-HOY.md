# Plan B — Foco y Momentum: entrega de hoy

## Regla de ejecución — una etapa por instrucción

Este documento es el mapa general, no una orden para ejecutarlo entero. Esta regla,
añadida por decisión de Ricardo, prevalece sobre cualquier secuencia amplia de abajo.

- Cada instrucción activa una sola etapa pequeña, con un entregable y un punto de cierre.
- Leer e investigar únicamente lo necesario para esa etapa; reutilizar contexto verificado.
- Terminar y comprobar ese entregable, mostrarlo brevemente y devolver el control a Ricardo.
- No encadenar automáticamente otra etapa ni adelantar otras pantallas o integraciones.
- Si aparece una dependencia grande, señalarla y acotar la etapa antes de ampliar el trabajo.
- El refinamiento global será una etapa independiente, después de las pantallas revisadas.

**Próxima etapa propuesta:** presentar únicamente el diagrama de Foco, usando «La mesa
libre». Entregable: un wireframe para revisión. Cierre: mostrarlo y esperar la decisión
de Ricardo. La construcción de Foco será una instrucción posterior.

## Decisión y objetivo

Construir una experiencia pequeña y cuidada, pantalla por pantalla, y después hacer un
refinamiento global. Ricardo prefiere ese resultado a un diseño completo, ambicioso y
mediocre. Este documento actualiza el Plan B adjunto con esa decisión y con los requisitos
de Linkup, Nebius y Render Workflows compartidos en la conversación.

El objetivo de hoy es demostrar una tarea útil de principio a fin: partir del vaciado y
del contexto guardado, elegir una acción, resolver un bloqueo con investigación real,
entregar un resultado respaldado por fuentes y conservar el progreso. El proceso de
investigación corre en segundo plano y puede recuperarse de un fallo.

Los tres premios tienen requisitos de elegibilidad previos a la puntuación. Una integración
pendiente no equivale a perder sólo los 15 puntos de integración: impide optar a ese premio.
Ningún track se declarará cumplido por tener un cliente, tablas, un mock o un plan.

Este archivo es un plan, no una certificación de implementación. Su actualización no
ejecuta despliegues, evaluaciones de pago ni cambios en la ficha del concurso.

## 1. Diseño: una pantalla cada vez, después refinamiento global

**Ciclo obligatorio por pantalla:**

1. Definir qué necesita lograr la persona y cuál es la acción principal.
2. Presentar únicamente el wireframe de esa pantalla, en diagrama, con contenido realista.
3. Ricardo decide qué se diseña, corrige o aprueba el diagrama.
4. Construir exclusivamente esa pantalla con el sistema existente, «La mesa libre».
5. Probar su interacción y revisar su versión de escritorio y móvil; mostrar el resultado.
6. Resolver los problemas de esa pantalla y obtener la revisión de Ricardo antes de pasar
   al diagrama de la siguiente.

No diseñar ni construir varias pantallas visibles en una pasada. La fontanería compartida
puede prepararse antes, pero no sirve de excusa para adelantar el diseño de las otras.
No se exige que la primera pantalla resuelva de antemano todos los detalles del sistema.

**Orden de las pantallas:**

1. **Foco:** entender y elegir el primer movimiento.
2. **Momentum:** hacer ese movimiento, ajustar el tamaño y resolver un bloqueo. Desde aquí se PIDE la investigación, pero la investigación sale de Momentum y tiene ventana propia.
3. **Tareas:** listado simple, marcar hecho y mover de bandeja. Estando en una bandeja se puede pedir investigar por área.
4. **Plan:** secuencia simple con su razón y, cuando corresponda, el efecto de los hallazgos.

El vaciado existente se conserva. Se añade una pantalla de investigación propia (decisión de Ricardo el 12 de septiembre) para que la persona pueda consultar las fuentes y la guía a su ritmo, sin sobrecargar la vista principal. No se añade un dashboard de operaciones sólo para exhibir patrocinadores.

**Después de revisar las pantallas, refinamiento global:**

- Unificar tipografía, espacios, anchos, densidad, botones, iconos y nombres de acciones.
- Revisar navegación, volver desde Momentum, barra inferior y continuidad del estado.
- Revisar foco de teclado, etiquetas, contraste, áreas táctiles y desbordamientos en móvil.
- Hacer coherentes espera, vacío, error, reintento, éxito y finalización.
- Comprobar que una sola cosa domina, el panel agrupa, la regla azul señala, hay una sola
  acción en barro por pantalla y completar deja menos ruido visual.

El refinamiento global ajusta coherencia; no reabre todas las pantallas ni incorpora nuevas
funciones. Se reserva tiempo para él antes de la verificación final de entrega.

## 2. Qué debe cumplir cada patrocinador hoy

La fuente de esta matriz son los briefs aportados por Ricardo en la conversación.

| Premio | Requisito obligatorio | Evidencia que debemos mostrar |
| --- | --- | --- |
| **Nebius — Applied AI** · USD 500 cash | Token Factory realiza inferencia en el flujo principal. Evaluación sobre entradas representativas y al menos una medida de exactitud, tiempo o costo por tarea. | Entrada real y resultado útil; resultados y método de evaluación; un caso en que el producto tiene dificultades; explicación de calidad, velocidad o costo. |
| **Linkup — Deep Research** · USD 500 cash | Buscar y recuperar información con Linkup, combinarla con datos guardados, almacenar hallazgos y usarlos para decidir qué investigar después. | Producto desplegado; fuentes; búsquedas posteriores derivadas de los hallazgos; efecto de lo investigado sobre el resultado; incertidumbre explícita. |
| **Render — Workflows** · USD 900 en créditos repartidos: 500 / 300 / 100 | Render Workflows ejecuta un proceso útil de varios pasos en segundo plano, con recuperación y protección ante efectos duplicados cuando hay reintentos. | Workflow desplegado de principio a fin; fallo controlado; recuperación; resultado final comprobado; estado y errores pendientes visibles; otra persona puede iniciarlo y recuperar su resultado. |

Para los tres, priorizar utilidad real, acceso desde fuera del equipo y una integración
esencial. Alojar Next.js en Render no satisface por sí solo Render Workflows. Mostrar una
consulta pendiente no satisface Linkup. Un self-test local no sustituye la evaluación real
de Nebius.

## 3. Estado observado y límites de esta revisión

En la revisión de archivos para este plan se encontraron `lib/nebius.ts`, `lib/triage.ts`,
`lib/linkup.ts`, las migraciones de dominio e investigación y archivos de evidencia.
No se ejecutaron sus integraciones ni se verificó un despliegue en esta revisión.

El README aún describe una llamada a Llama 3.3 70B, mientras que el contexto del proyecto
documenta dos fases con Gemma 3 27B. Corregirlo contra configuración y evidencia verificadas.
`lucide-react` ya figura en las dependencias: no planificar su instalación como trabajo nuevo.

Los documentos anteriores contienen fechas y expresiones como «el sábado» o «después» que
no deben guiar esta entrega. Se trabaja con el cierre inminente indicado por Ricardo;
confirmar la hora exacta en la convocatoria antes de publicar, sin inventar un plazo.

## 4. Un recorrido que conecte los tres premios

Caso de demostración propuesto: una persona tiene pendiente publicar su portafolio y no
sabe cómo empezar. Ya guardó en DOMI que tiene un repositorio, poco tiempo y un bloqueo
con la publicación. El trabajo que completa DOMI es **preparar una guía de publicación
adaptada a ese contexto, con pasos verificables, fuentes y un primer movimiento concreto**.
No afirmar que el sitio quedó publicado si sólo se preparó la guía.

1. Nebius procesa el vaciado y el contexto guardado; propone un arranque en Foco.
2. La persona entra en Momentum y expresa el bloqueo.
3. Nebius identifica una pregunta que requiere información actual. Se crea una ejecución
   de investigación real en Render Workflows.
4. Linkup busca documentación pertinente. Se guardan consulta, hallazgos y fuentes.
5. Nebius lee esos hallazgos guardados y detecta una laguna concreta: por ejemplo, un
   requisito de configuración que depende del tipo de proyecto.
6. Se formula una segunda búsqueda a partir de esa laguna y se consulta Linkup de nuevo.
   No son dos búsquedas prefijadas independientes ni una repetición decorativa.
7. Se contrastan los hallazgos con el contexto y se produce la guía, con fuentes por
   afirmación relevante y pendientes sin confirmar. Los pasos en Momentum se actualizan
   cuando la persona acepta usarlos.
8. La persona completa una acción y puede recuperar la guía y el progreso al volver.

Elegir para la demo un caso que necesite seguimiento real. Si una investigación encuentra
suficiente información antes, debe poder parar; no fabricar incertidumbre para forzar
búsquedas. Para hoy, acotar el bucle a un máximo de dos búsquedas sucesivas y mostrar como
pendiente lo que no quede resuelto con ese presupuesto.

## 5. Trabajo funcional que sostiene las pantallas

### Puente y sesión

Crear `lib/session.ts` y `components/use-session.ts` para convertir las salidas de triage
en tareas identificables, con bandeja, orden, dependencias, micro-pasos y estado de avance.
Persistencia local versionada, lectura y escritura protegidas y arranque válido sin sesión.

Cruzar títulos primero de forma exacta y después normalizada. Si la correspondencia es
ambigua, no inventar dependencias ni fusionar tareas distintas. Conservar tareas y progreso
entre vaciados; la deduplicación aproximada y los contadores para Rescate pueden esperar.
No borrar silenciosamente lo anterior al hacer un nuevo vaciado.

Separar tarea terminada de paso terminado. Conservar estados completados al cambiar de
presupuesto, y no permitir que una respuesta tardía sobrescriba la tarea seleccionada o
el presupuesto más reciente.

### Nebius: ajustar y desbloquear

Mantener el contrato evaluado de `lib/triage.ts`. Añadir en `lib/assist.ts` y su ruta validada:

- Recorte de 2/5/10 minutos con inferencia real y un primer paso que quepa en el presupuesto.
- Desbloqueo con una respuesta breve, acción inmediata, pasos revisados y, cuando haga falta,
  petición de investigación web que inicia el proceso de Linkup y Render Workflows.

El Plan B original decía a la vez «cada toque consulta al modelo» y «un presupuesto ya
pedido sale desde caché». Para esta entrega prevalece la decisión documentada de Ricardo:
ajustar el presupuesto vuelve a consultar al modelo. No incluir esa caché contradictoria.
Mientras responde, conservar los pasos anteriores y mostrar el estado de espera.

No cambiar de proveedor o modelo ni introducir otro para la memoria sin una decisión
explícita. La memoria mínima del recorrido puede recuperar tareas y hallazgos por sus ids;
no necesita búsqueda vectorial para cumplir este caso.

### Linkup: investigación real con memoria de hallazgos

Conectar el cliente existente con un registro duradero de cada investigación. Reutilizar
las tablas existentes donde encajen; no crear otra capa sin revisar antes el esquema.

Guardar como mínimo: ejecución y tarea asociadas, consulta y su motivo, hallazgos, URLs,
evidencia relevante recuperada, fecha de consulta, qué está respaldado o pendiente y la
pregunta siguiente con el hallazgo que la originó. La siguiente decisión debe leer los
hallazgos ya guardados, no depender exclusivamente de variables en memoria del proceso.

Verificar que la fuente respalda la afirmación concreta y que aplica al contexto de la
persona. Preferir documentación primaria y señalar desacuerdos. Dos dominios distintos
no bastan para afirmar que una conclusión es sólida. Revisar el filtro temporal del cliente:
una documentación vigente no debe descartarse automáticamente por su fecha de publicación.

La vista de investigación muestra «qué encontré», «qué faltaba», «qué busqué después» y
«qué cambió en tus pasos», con fuentes abribles y dudas explícitas. Una lista de enlaces
sin efecto en la respuesta no completa el objetivo.

### Render Workflows: ejecución y recuperación

Configurar un servicio real de Render Workflows. El workflow ejecuta pasos con resultados
persistidos: recuperar contexto → búsqueda inicial → guardar hallazgos → decidir seguimiento
→ búsqueda posterior cuando proceda → guardar y comprobar evidencia → generar y guardar guía.

La aplicación inicia una ejecución, conserva su identificador y permite consultar estado
y recuperar el resultado después de recargar. El trabajo no depende de que la pestaña siga
abierta. Reutilizar resultados de pasos ya completados durante la recuperación.

Configurar reintentos acotados para errores transitorios. Guardar estado y error pendiente
cuando se agotan; permitir reanudar según el tipo de fallo. Una credencial inválida no se
resuelve reintentando indefinidamente.

Usar identidad estable de ejecución, paso y operación lógica, con restricciones únicas o
escrituras equivalentes, para impedir hallazgos, guías o tareas duplicadas por reintentos.
No prometer que un reintento evita todo consumo extra de las APIs si el proveedor respondió
pero se perdió la confirmación.

**Prueba del premio:** inyectar un fallo de demostración de una sola vez después de guardar
un resultado intermedio, hacer visible el intento fallido, recuperar y comprobar que el
resultado final y los registros no se duplicaron. Limitar la inyección al caso de demo.
Comprobar también el estado de error no recuperado, sin presentarlo como éxito.

### Persistencia y acceso: resolver la contradicción previa

El contexto anterior dice tanto «sin cuenta no se guarda contenido en servidor» como
«los hallazgos se guardan y el proceso sigue en segundo plano». Definir antes de implementar
la persistencia qué datos se guardan, dónde y cómo se recuperan; no mantener ambas promesas
si la implementación no las puede cumplir.

Para verificar el flujo sin datos personales, usar un caso de demo con contexto de ejemplo
guardado. Ese caso no sustituye permitir que un usuario externo introduzca su propia tarea,
inicie el proceso y recupere el resultado. El acceso a ejecuciones debe quedar aislado por
sesión o cuenta, aprovechando la infraestructura existente. No publicar una promesa de
«nada se guarda» si hay contenido persistido. La decisión del modo invitado queda pendiente
de concretar al conectar la memoria, sin bloquear la actualización de este plan.

## 6. Alcance de cada pantalla

| Pantalla | Entrega mínima cuidada |
| --- | --- |
| **Foco** | «Empieza por aquí» dominante; 2/5/10 minutos; primer micro-paso; «Arrancar» como acción principal; elegir otra tarea; hasta tres prioridades; protección del foco y trampas en segundo plano; acceso a bandejas. |
| **Momentum** | Una tarea y su acción actual; marcar pasos; cronómetro sencillo con pausa y reinicio; ajuste de tiempo; «¿Qué te frena?»; investigación con estado, fuentes y resultado; aceptar pasos revisados; finalización clara. |
| **Tareas** | Cuatro bandejas plegables: Personal, Trabajo, Casa, Social; marcar hecho y mover bandeja; progreso persistente. |
| **Plan** | Secuencia numerada, dependencias y su razón; indicar cambios derivados de evidencia cuando existan; sólo lectura. |

La investigación no tapa la acción actual. Fuentes, búsquedas e intentos se pueden consultar
sin convertir la vista principal en una consola técnica. Su accesibilidad para los jueces
no exige añadir otra pantalla.

Resolver la competencia entre «Arrancar» y el botón de nuevo vaciado en la barra móvil:
sólo uno recibe el énfasis de barro en esa pantalla. No copiar simultáneamente dos acciones
principales del prototipo.

## 7. Orden de ejecución y recortes

1. Comprobar acceso y requisitos técnicos de Nebius, Linkup y Render Workflows, evidencia
   existente y hora de entrega. Identificar bloqueos pronto, sin dar integraciones por listas.
2. Preparar sesión, identificadores y persistencia mínima; definir el contrato de investigación
   y la ejecución con estados. Concretar la decisión de almacenamiento antes de escribir datos.
3. **Diagrama de Foco → decisión de Ricardo → construcción → prueba y revisión.**
4. Conectar investigación real y recuperación como soporte de Momentum.
5. **Diagrama de Momentum → decisión de Ricardo → construcción → prueba y revisión.**
6. Repetir el mismo ciclo, individualmente, con **Tareas** y después **Plan**.
7. Hacer el **refinamiento global** de las pantallas ya revisadas.
8. Verificar build, flujo público, evaluación y recuperación; preparar documentación y
   evidencias. Dejar tiempo protegido para desplegar, comprobar desde fuera y grabar la demo.

Los preparativos técnicos del despliegue se investigan temprano; no descubrir sus requisitos
por primera vez al final. La publicación sigue las decisiones humanas del repositorio y
se presenta con el resultado concreto listo para revisión.

Si falta tiempo, recortar primero animaciones, hitos del cronómetro, modos extra, memoria
vectorial, Rescate, deduplicación aproximada y funciones de cuentas no necesarias para el
recorrido. No recortar fuentes, seguimiento basado en hallazgos, recuperación, estado visible,
evaluación o acceso externo y seguir afirmando que se cumplen los tres premios.

Si un requisito obligatorio queda bloqueado, informar qué track queda sin elegibilidad
demostrada y qué falta exactamente. No sustituirlo por una simulación ni ocultar la limitación.

## 8. Evidencia de Nebius: conservar y completar

Conservar `lib/triage.ts`, `lib/verify.ts`, `tests/eval.mjs` y los archivos originales de
`evaluation-evidence/` mientras se añade la experiencia alrededor. La huella de `triage.ts`
identifica la versión de ese archivo; no certifica por sí sola el resto de dependencias,
las llamadas nuevas, la investigación ni todo el producto.

Revisar entradas, modelo, configuración, versión y mediciones antes de citar cifras. Los
resultados históricos se presentan como históricos y con su alcance. No extrapolar un
«5 de 5» del triage a la guía investigada ni a una calificación de los jueces.

Para el flujo ampliado, documentar casos representativos, criterio de utilidad, latencia y/o
costo realmente medidos, incluyendo un caso difícil. Contabilizar por separado las llamadas
adicionales; el costo del vaciado no es el costo total de la investigación. Si se publica
exactitud, especificar qué comprueba la rúbrica y qué no.

Ejemplo de dificultad que debe probarse, no fingirse: las fuentes no resuelven un requisito
o contradicen el contexto. Mostrar cómo queda señalado y qué resultado parcial se entrega.

## 9. Verificación y cierre

- [ ] `npm run typecheck` y `npm run build` terminan correctamente.
- [ ] `node tests/eval.mjs --self-test` pasa; contrastar aparte las huellas con la evidencia.
- [ ] La evaluación real disponible tiene metodología, entradas representativas, medidas y
  un caso difícil; verificar también las nuevas salidas que se presentan como evaluadas.
- [ ] La sesión conserva tareas y pasos al recargar; los cruces ambiguos no inventan relaciones.
- [ ] Recorte real 2/5/10, desbloqueo, marcar paso, terminar tarea y mover bandeja funcionan.
- [ ] Linkup recupera fuentes; se guardan hallazgos; una búsqueda posterior usa lo aprendido.
- [ ] La guía refleja el contexto guardado y explica qué cambió por la investigación.
- [ ] Render Workflows ejecuta el proceso desplegado; estado y resultado sobreviven a cerrar
  o recargar la vista.
- [ ] Fallo controlado y recuperación comprobados; no hay efectos duplicados; los errores
  pendientes son visibles.
- [ ] Recorrido completo en escritorio y móvil de 375 px, con las pantallas revisadas una a una.
- [ ] Refinamiento global completado sin ampliar el alcance.
- [ ] Una persona externa puede introducir una tarea, iniciar el proceso y recuperar un resultado.
- [ ] README y evaluación describen el producto real, con URL válida y límites explícitos.
- [ ] Evidencias y guion de demo muestran entrada → contexto → primera búsqueda → hallazgo
  guardado → seguimiento → recuperación → resultado y acción completada.

El cierre de diseño ocurre después del refinamiento global. El cierre de entrega ocurre
después de comprobar la versión desplegada y reunir evidencia de cada requisito obligatorio.
No termina al generar capturas ni al pasar TypeScript.

## Referencias de implementación

Los requisitos de premios provienen del texto compartido por Ricardo. Para implementar y
verificar las integraciones, contrastar las APIs vigentes con su documentación primaria:

- [Linkup: referencia de búsqueda](https://docs.linkup.so/pages/documentation/endpoints/search/reference).
- [Linkup: prácticas de búsqueda](https://docs.linkup.so/pages/documentation/endpoints/search/best-practices).
- [Render: introducción a Workflows](https://render.com/docs/workflows), que documenta tareas
  registradas en un servicio y reintentos configurables ante fallos.
- [Render: primer workflow](https://render.com/docs/workflows-tutorial).

La documentación de plataforma no sustituye los briefs del concurso ni demuestra que
DOMI ya cumple sus condiciones.
