# Backend remediation — operación y límites

Estado al cierre del 13 de septiembre de 2026: la migración
`0007_admission_and_execution.sql` **está aplicada y verificada en la base real**, la
admisión está **abierta** en `domi-web` y en `domi-research`, y
`4eaba8786493558860def32f9441e702861518dc` está desplegado en ambos servicios. La
incidencia de esquema divergente que este documento registraba queda cerrada; su
registro se conserva más abajo con la evidencia de cierre.

El 13 de septiembre de 2026 Ricardo recorrió el flujo completo en producción sobre ese
commit y lo dio por bueno: es la primera vez que el recorrido de punta a punta funciona
sobre el commit desplegado. Esa verificación es del operador y no dejó aquí los
identificadores ni los registros de la corrida; mostrarla como evidencia ante terceros
exige recuperarlos del panel de Render.

No se han modificado migraciones históricas, proveedores, modelos ni el esquema de
producto de `lib/triage.ts`.

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
Publicar la rama no cambia ese estado: la aplicación pública queda sin aceptar trabajo
hasta habilitar manualmente ambos servicios por separado.
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
La opción TLS preexistente no se altera. `DATABASE_SSL` no está configurada en `domi-web`
ni en `domi-research`: ambos conectan por la red privada de Render sin TLS, y así lo
declara la sonda de arranque del Workflow. Es una discrepancia documentada y no
bloqueante mientras la base siga siendo alcanzable sólo desde esa red; si eso cambia,
`DATABASE_SSL=require` deja de ser opcional y su validación de certificado —hoy con
`rejectUnauthorized: false`— tendría que revisarse antes.

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

### Incidencia cerrada: el esquema real ya sostiene el contrato nuevo

La migración `0007_admission_and_execution.sql` se aplicó a la base real el 13 de
septiembre de 2026 y quedó comprobada con consultas de sólo lectura contra la base
desplegada: `_migrations` registra `0007_admission_and_execution.sql` con la huella
esperada; existe `admission_counters`; `runs` tiene `guest_owner`, `idempotency_key`,
`request_hash`, `generation`, `dispatch_state`, `dispatch_started_at` y
`correlation_id`; existe `run_steps.generation`; y existen los índices
`runs_guest_idempotency` y `runs_guest_active`. La sonda de arranque del Workflow
reporta la base alcanzable en decenas de milisegundos y sin error SQL de esquema.

Con eso desaparece la incompatibilidad que bloqueaba las rutas del contrato nuevo:
lecturas autorizadas sobre `runs.guest_owner`, `runs.dispatch_state` y
`runs.dispatch_started_at`, registro de cuota en `admission_counters`, mutaciones y
ejecutor. La admisión se abrió después y por separado —`DOMI_ADMISSION_ENABLED=true` en
`domi-web` y en `domi-research`—, que es el orden que este documento exigía.

Queda pendiente una prueba distinta, que el esquema no cubre: una investigación completa
ejecutada sobre el commit vivo. Ver «Estado de producción al cierre del 13 de septiembre
de 2026».

## Procedimiento ejecutado — migración 0007 (aplicada el 13 de septiembre de 2026)

Este procedimiento se ejecutó con autorización expresa y separada el 13 de septiembre de
2026. Se conserva íntegro como registro de lo aplicado y como guía de re-verificación:
los pasos 2, 3 y 5 siguen siendo las consultas vigentes para comprobar ledger y esquema.
Durante la operación `DOMI_ADMISSION_ENABLED` se mantuvo cerrada en web y Workflow; la
admisión se abrió después, en un paso aparte.

1. Confirmar el destino de `DATABASE_URL`, TLS, propietario de la base y una copia de
   seguridad recuperable. El rol debe poder crear `admission_counters`, alterar `runs`
   y `run_steps`, crear índices y escribir en `_migrations`. Reservar una ventana sin
   escritores, un único operador y admisión cerrada: el runner no impone un lock global
   ni `lock_timeout`, y los índices ordinarios de 0007 pueden bloquear escrituras.
2. Consultar el catálogo y `_migrations` en modo lectura. Confirmar que 0001–0006 están
   registradas con el hash que corresponde al repositorio y que 0007 no figura aplicada.
   Detenerse ante un hash distinto, un ledger ausente o cualquier migración anterior
   pendiente. `tools/migrate.mjs` no tiene selector: aplicaría **todas** las pendientes.
   La consulta de ledger es:

   ```sql
   SELECT name, sha256, applied_at FROM _migrations ORDER BY name;
   ```

   Las huellas esperadas son:

   | Migración | SHA-256 normalizado |
   | --- | --- |
   | `0001_auth.sql` | `9bae194857e5764ea9f351b2d9b98026f73e856aaa37a472cd5d40ed00e8d4d3` |
   | `0002_domain.sql` | `59aef72dd963f2c73fe9663d4aea71380ec085cd3730d2e5028b45d7248e06f4` |
   | `0003_research.sql` | `33efb287853f6dca9abf3701432066f90f3f03dc493e8d24ec6d2d94c9a5bce7` |
   | `0004_render_workflows.sql` | `59391eaf49942c6ebd98756cdbb8d4334c14db7d6833e372af1c6bbc45e25c22` |
   | `0005_research_locks.sql` | `a0cd39f128a6bf2d12e9bcd99e753097a87432d48fc9e482b2be3ee8a617bc1d` |
   | `0006_run_ok_starts_false.sql` | `77ab598e1f048d5e25a4e3dc242e84e4c1044fb31d1108144b4226378edbb1a9` |
   | `0007_admission_and_execution.sql` | `9ac762371eb9f637bac8531b1063a6315341cc02f719c5912113886ee441a379` |
3. Verificar localmente la huella normalizada de 0007 antes de ejecutar: debe ser
   `9ac762371eb9f637bac8531b1063a6315341cc02f719c5912113886ee441a379`. No usar
   `tools/migrate.mjs --dry-run` como sonda de sólo lectura: crea `_migrations` si no
   existe.
4. Con la aprobación expresa, ejecutar una sola vez el migrador contra el destino
   confirmado. Primero correr `npm run migrate -- --dry-run`: debe informar sólo
   `pendiente: 0007_admission_and_execution.sql`; cualquier otra pendiente o diferencia
   cancela la operación. Después, sin cambiar commit, destino ni TLS, correr
   `npm run migrate`. Registrar la salida, sin imprimir credenciales. El migrador ejecuta
   cada archivo dentro de su propia transacción y registra la huella sólo después del
   `COMMIT`. No ejecutar el archivo con `psql -f`: perdería el ledger y las garantías del
   runner.
5. Verificar antes de cualquier activación que `_migrations` contiene 0007 con la huella
   esperada; que existe `admission_counters`; que `runs` tiene `guest_owner`,
   `idempotency_key`, `request_hash`, `generation`, `dispatch_state`,
   `dispatch_started_at` y `correlation_id`; que `run_steps.generation` existe; y que
   existen los índices `runs_guest_idempotency` y `runs_guest_active`. Las consultas de
   comprobación son:

   ```sql
   SELECT name, sha256 FROM _migrations
   WHERE name = '0007_admission_and_execution.sql';
   SELECT to_regclass('public.admission_counters') AS admission_counters;
   SELECT table_name, column_name
   FROM information_schema.columns
   WHERE (table_name = 'runs' AND column_name IN
     ('guest_owner', 'idempotency_key', 'request_hash', 'generation',
      'dispatch_state', 'dispatch_started_at', 'correlation_id'))
      OR (table_name = 'run_steps' AND column_name = 'generation')
   ORDER BY table_name, column_name;
   SELECT indexname FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'runs'
     AND indexname IN ('runs_guest_idempotency', 'runs_guest_active')
   ORDER BY indexname;
   ```
6. Revisar pasivamente logs de web y Workflow por errores SQL o `workflow.db_probe`.
   Mantener admisión cerrada y no iniciar investigaciones ni Nebius. Sólo una nueva
   autorización puede habilitar por separado los dos servicios.

Si la migración falla, el migrador hace `ROLLBACK` de esa migración y no escribe su
ledger. No reintentar a ciegas: comprobar `_migrations` y el catálogo, conservar la
evidencia y el respaldo, y detenerse si hay cualquier columna, tabla o índice parcial.
No editar 0007 ni borrar filas del ledger. Una divergencia fuera de la transacción
requiere una migración correctiva aditiva y aprobación de arquitectura/Ricardo.

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

## Verificación e integración de `068f08c` (13 de septiembre de 2026)

`npm test`: **82 pruebas aprobadas**, incluidas las 44 preexistentes, sin proveedores reales.
`npm run test:backend-sql`: **8/8 casos aprobados** contra PostgreSQL local desechable,
sin fallos ni omisiones. Esta evidencia cubre cuotas, propiedad, idempotencia, claims,
fencing y rollback; no certifica Better Auth, pgvector ni el esquema real.

Typecheck y build con configuración sintética completados. El build informa que
Better Auth no pudo validar la DB ficticia y advierte sobre el fallback de la fuente;
ninguno de esos mensajes certifica ni invalida el esquema real. Evaluador en
`--self-test` y `--dry-run`: aprobados, cero llamadas externas.

`068f08c0c163f3653a687e2bf39be683ee2a4912` se integró y publicó en `main`.
`domi-web` completó su despliegue en Render, quedó `live` y respondió HTTP 200;
`domi-research` registró la versión `068f08c` en estado `ready` y el slug
`domi-research/research` resuelve a ella. Esto confirma build, disponibilidad web y
registro de tareas, no compatibilidad con la base real ni una ejecución end-to-end.

Esa batería, por sí sola, no tocó la base real: al escribirla, `0007` seguía sin
aplicarse, la admisión estaba cerrada y no se ejecutó Nebius, Linkup ni E2E pagado.
Better Auth, pgvector, la migración completa desde una base existente y la concurrencia
compleja entre workers siguen fuera de esta batería.

## Estado de producción al cierre del 13 de septiembre de 2026

Migración `0007` aplicada y verificada en la base real: `admission_counters`, las ocho
columnas del contrato nuevo y los índices de idempotencia están presentes, con la huella
de ledger esperada. Admisión abierta en `domi-web` y en `domi-research`. Ambos servicios
sirven `4eaba8786493558860def32f9441e702861518dc`: `domi-web` en estado `live` y
`domi-research` con esa versión registrada y lista por auto-deploy. En la web están
presentes las claves de base, Nebius, Linkup, API de Render y Better Auth, con el slug
`domi-research`; en el Workflow, las de base, Nebius y Linkup. La sonda de base del
Workflow responde en decenas de milisegundos, sin TLS y sin error SQL.

Evidencia de ejecución: Render registra doce corridas de investigación con estado de
éxito, todas con `068f08c`. El estado de plataforma no es un juicio sobre la calidad del
resultado: el falso éxito con cero hallazgos que originó esta remediación también terminó
«bien» para Render.

Sobre el commit vivo `4eaba87`, **Ricardo recorrió el flujo completo en producción el 13
de septiembre de 2026 y lo dio por bueno**. Es la primera vez que el recorrido de punta a
punta funciona sobre el commit desplegado. Queda registrado como verificación del
operador: no se archivaron aquí los identificadores de esa corrida ni sus registros, de
modo que para mostrarla como evidencia ante terceros habría que recuperarlos del panel de
Render.

`DATABASE_SSL` no está configurada en ninguno de los dos servicios; hoy conectan por la
red privada de Render sin TLS. Documentado, no bloqueante para este sprint.

Procedencia de esta sección: consultas de sólo lectura a la base y al panel de Render
hechas por el operador el 13 de septiembre de 2026. Los archivos
`evaluation-evidence/production-ignition-2026-09-13.txt` y
`evaluation-evidence/production-entry-fix-2026-09-13.txt` conservan los registros del
encendido, de la corrección de `BETTER_AUTH_URL` y de la sonda de base sin TLS.

Advertencia registrada: Node recompila `lib/db.ts` como ESM porque `package.json` no
declara `type: "module"`; es deuda técnica no bloqueante y queda fuera de esta rama.
Los tres informes de auditoría preexistentes se conservan sin cambios.
