# Backend remediation — operación y límites

Estado: implementación local; **no autoriza migrar, desplegar ni habilitar admisión**.
La migración aditiva es `db/migrations/0007_admission_and_execution.sql`. No se han
modificado migraciones históricas, proveedores, modelos ni el esquema de producto
de `lib/triage.ts`.

## Contratos

- Se mantiene el acceso sin cuenta. Un POST JSON del mismo origen a `/api/guest`
  establece una cookie firmada, HttpOnly, SameSite=Lax, de 30 días; en producción
  usa Secure y prefijo `__Host-`. La firma usa `BETTER_AUTH_SECRET` con separación
  de propósito, sin inicializar Better Auth.
- `BETTER_AUTH_URL` debe ser el origen exacto de la aplicación. Todas las mutaciones
  requieren Origin coincidente y JSON. No se confía en Host/X-Forwarded-For para
  acreditar origen ni IP. El límite real de bytes se comprueba leyendo el stream.
- Research: POST de creación requiere `Idempotency-Key` (16–128 caracteres,
  letras, números, `_` o `-`). Misma clave/propietario/entrada normalizada devuelve
  el mismo run; otro contenido con esa clave devuelve 409. Cuotas, propietario,
  clave y run se guardan en una transacción.
- GET y resume requieren la cookie propietaria. UUID conocido, cookie ausente,
  alterada/caducada o run histórico sin propietario no transfieren acceso: 404.
  No se adjudican runs antiguos. Perder la cookie pierde el acceso invitado.
- GET nunca dispara proveedores ni workflows. Sus únicos cambios son contadores
  de lectura, después de comprobar propietario. Una consulta a UUID ajeno no
  asigna filas de cuota. Lecturas autorizadas siguen disponibles con admisión
  pagada cerrada, siempre que DB y limitador funcionen.
- La respuesta 202 confirma aceptación del ejecutor (o ejecución en el proceso
  local de desarrollo), no finalización. `done` devuelve 200. Rechazo o aceptación
  incierta devuelven 503 con `runId`, `accepted:false` y `dispatchState`.
- El cliente conserva la clave antes del envío y después de la aceptación para
  sobrevivir a una recarga entre la respuesta y el guardado de la sesión. Un
  reintento de la misma entrada reutiliza esa clave. “Pedir otra investigación”
  retira intenciones confirmadas; nunca borra las de aceptación incierta.

## Admisión y consumo

`DOMI_ADMISSION_ENABLED=true` es necesario en **web y workers**. Ausente, false o
inválido significa cerrado. No habilitarlo hasta pasar las puertas de publicación.
Las claves existentes no se cambian automáticamente. El interruptor se comprueba
al admitir y antes de reservar cada proveedor; no cancela llamadas ya aceptadas.

| Control | Límite |
| --- | --- |
| Investigación nueva | 3/día/invitado; 10/día/bucket IP |
| Investigaciones activas | 1/invitado, también al reanudar |
| Triage, ambas fases sumadas | 6/min e invitado; 20/día/invitado; 60/día/bucket IP |
| Lecturas research | 120/min/invitado propietario |
| Nebius global | 300 reservas de intentos HTTP/día |
| Linkup global | 60 solicitudes/día |
| Despacho orquestador Render global | 20/día, incluyendo resume |
| Intentos de trabajo por paso | 4 acumulados, incluso entre generaciones |
| Cuerpo HTTP | Research 8 KiB; triage 64 KiB |
| activationHook devuelto por cliente | 1.000 caracteres; no cambia el esquema de salida |

Ventanas fijas UTC, calculadas por PostgreSQL. Reservas atómicas compartidas entre
procesos, sin contadores de seguridad en memoria. Cada generación Nebius reserva
dos intentos para `maxRetries:1`; una reparación reserva otros dos. No hay reembolso
por aceptación incierta. Cuota agotada: 429 y Retry-After conservador; DB de cuotas
indisponible: 503 y ninguna llamada nueva al proveedor desde esa rama.

**Todavía no existe una frontera de proxy acreditada en este repositorio.** Por
eso todas las IP comparten el bucket restrictivo `unverified-proxy-shared`; no se
acepta un encabezado arbitrario. En esta configuración el límite por IP es,
efectivamente, compartido por todo el tráfico. Introducir IP real requiere verificar
el proxy y su saneamiento de encabezados antes de cambiar este módulo.

Estos límites acotan invocaciones, **no dólares ni facturación exactamente una vez**.
Los reintentos de subtareas Render siguen acotados por su configuración y el límite
acumulado del paso; también pueden consumir cómputo sin una llamada al proveedor.
Un proceso puede morir después de pagar y antes de persistir: se acepta esa ventana.

## Ejecución, recuperación y persistencia

Se conserva PK `(run_id, step)`, claim `ON CONFLICT`, lease de cinco minutos,
índice único por vuelta y reutilización de `done`. El claim devuelve `attempt`;
la finalización comprueba intento, lease y generación vigente bajo locks DB.
Pregunta, fuentes (URLs únicas, máximo ocho) y resultado del paso se confirman en
una transacción corta **después** de la respuesta externa. No se mantiene una
conexión ni transacción mientras se espera al proveedor. Una pregunta existente
sin un paso terminado produce `INCOMPLETE_ROUND`; no se reutiliza ni limpia a ciegas.

Solo `finishRun` declara éxito: exige los cinco pasos, fuentes, hallazgos y guía
con pasos respaldados. Una guía vacía tras grounding no se guarda como `done`.
Un worker que perdió permiso no escribe; un fallo tardío no degrada `done`.

Web y Workflows usan el contrato interno **(runId, generation, correlationId)**.
Workers viejos deben drenarse antes de activar la versión nueva. Los argumentos
antiguos fallan cerrados. La contención viaja como `{kind:'busy'}`, y los fallos de
política como `{kind:'stopped'}`; no se depende de conservar clases a través del SDK.

Despacho `sending`/`unknown`: nunca se reenvía automáticamente por haber pasado
tiempo. Una reclamación válida de un worker acredita recepción y cambia a
`accepted`; de lo contrario, requiere reconciliación administrativa. Si Render
acepta pero falla guardar su ID, no se ejecuta fallback. Producción sin Render
devuelve error explícito; desarrollo sin clave puede ejecutar localmente.

Un despacho aceptado activo no se duplica. Un run fallido puede reanudarse si no
hay un paso con lease vigente ni otra investigación activa del visitante. Tras
25 minutos un despacho aceptado abandonado puede reclamar una nueva generación;
el servidor vuelve a comprobar el lease y los intentos. GET no lo hace por sí solo.

Reconciliación manual (requiere autorización para operar la infraestructura):

1. Cerrar nuevas admisiones y comprobar `runId`, generación, estado y correlación.
2. Buscar evidencia de aceptación/ejecución en Render, sin lanzar otra tarea.
3. Si se confirma aceptación, asociar el task run a esa generación; esperar o
   confirmar su terminación antes de recuperar. Una ausencia momentánea en logs
   no demuestra rechazo.
4. Solo con no-aceptación confirmada se puede liberar el bloqueo de despacho.
   No se incluye un endpoint público ni un script que adivine esta decisión.

El fallback local pierde su promesa en memoria al reiniciar el proceso. El run y
los pasos persistidos se conservan, pero necesitan resume explícito; no hay barrido
automático ni promesa de durabilidad del ejecutor local.

Research guarda tarea/área, bloqueo, preguntas, fuentes, guía y estados en DB.
Triage no guarda el contenido del vaciado en DB: sí guarda contadores seudónimos.
No se implementa borrado automático de datos históricos ni backfill de propietarios.

## Observabilidad y base de datos

Logs JSON con correlación, fase/run/paso/intento/generación y códigos permitidos.
No se serializan Error, message, stack, cause, SQL con parámetros, cookies, claves,
prompts ni respuestas externas. Un fallo secundario de persistencia se registra sin
ocultar el primario. El modelo persistido para investigación es RESEARCH_MODEL.

El pool sigue en `max:5` por proceso, con espera de conexión 10 s, SQL 10 s, lock 3 s
y conexión ociosa 30 s. Hay listener de errores ociosos y liberación en finally.
No se afirma que cinco sea un cuello de botella. Faltan mediciones y límites DB.
La opción TLS preexistente no se altera; su validación de certificado sigue pendiente
de revisar frente a la red/configuración reales.

## Pruebas y puertas antes de publicación

- `npm test`: pruebas puras, rutas y proveedores simulados. No carga `.env.local`.
- `node tools/verify-local.mjs typecheck`: comprobación de tipos con configuración sintética.
- `node tools/verify-local.mjs build`: build local con admisión cerrada, claves vacías y
  DB ficticia de loopback. Puede avisar que no pudo validar Better Auth; eso no prueba
  el esquema vivo. Tampoco es un artefacto listo para producción.
- `npm run test:backend-sql`: requiere `DOMI_TEST_DATABASE_URL` apuntando a una base
  desechable `domi_test...` en **127.0.0.1 o ::1**, sin parámetros de URL, y
  `DOMI_TEST_DB_ALLOW_WRITE=synthetic-only`. Crea/elimina únicamente un esquema aleatorio
  de datos sintéticos. Sin URL queda omitida explícitamente. Nunca usa DATABASE_URL
  como fallback ni dotenv. Usa el subconjunto research y la migración nueva sobre
  un fixture mínimo; no certifica Better Auth ni pgvector.
- No ejecutar `tests/research.e2e.mjs --run` ni evaluación real como sustituto: usan
  servicios pagados. El E2E histórico conserva valor de evidencia anterior, pero su
  contrato viejo no valida la nueva generación/propiedad.

**Bloqueo de validación en este entorno:** no se encontró PostgreSQL/Docker local.
Las pruebas SQL reales y la compatibilidad con el esquema desplegado siguen pendientes.
Los mocks verifican decisiones, orden y tratamiento de fallos; no prueban la semántica
de locks de PostgreSQL. No se debe habilitar admisión basándose solo en ellos.

Antes de publicar: completar SQL aislado, revisar migración y permisos del rol de aplicación contra esquema real
(solo con autorización), revisar los workers/SDK desplegados, coordinar versiones,
verificar origen/proxy y aprobar activación. Se mantiene el acceso público cerrado
por defecto hasta completar esas puertas. No se afirma un nuevo score certificado.

## Rollback y stop conditions

Cerrar `DOMI_ADMISSION_ENABLED` en web/workers, detener nuevos despachos y drenar
ejecutores antes de revertir contratos de ejecución. Conservar columnas, propietarios,
claves únicas y datos aditivos. No eliminar contadores para recuperar presupuesto.
No volver a una versión pública que permita gasto sin límites o acceso solo por UUID.
Timeouts DB pueden revertirse separadamente si las mediciones lo justifican; mantener
redacción de logs y controles de admisión.

Detener implementación/publicación si requiere otra migración, un contrato no aprobado,
credenciales nuevas, infraestructura externa o producción; si el esquema o SDK reales
contradicen lo asumido; o si recuperar datos históricos exige adjudicar un propietario
sin prueba. Documentar el bloqueo antes de continuar.

## Verificación local del 13 de septiembre de 2026

`npm test`: **82 pruebas aprobadas**, incluidas las 44 preexistentes, sin proveedores reales.
`npm run test:backend-sql`: **una suite omitida**, ninguna garantía SQL real certificada.

Typecheck y build con configuración sintética completados. El build informa que
Better Auth no pudo validar la DB ficticia y advierte sobre el fallback de la fuente;
ninguno de esos mensajes certifica ni invalida el esquema real. Evaluador en
`--self-test` y `--dry-run`: aprobados, cero llamadas externas.

La batería SQL se intentó y quedó omitida por ausencia de base desechable. No se
ejecutaron migraciones, workflows remotos, E2E pagados, push ni despliegues. No se
instalaron paquetes. Los tres informes de auditoría preexistentes se conservan sin cambios.
