# BACKEND QUALITY SCORE: 49/100 (CAPPED)
VERDICT: POOR (Dangerous)

## The uncomfortable truth

Debajo de una capa de protección de concurrencia inusualmente madura y de un modelo de dominio bien pensado, este backend sufre de una ingenuidad fatal en su modelo de amenazas. Has construido una máquina de combustión excelente, con sistemas de control de válvulas (locks, idempotencia) diseñados para soportar estrés mecánico masivo, pero la dejaste en la acera con las llaves puestas y el motor encendido. 

El problema sistémico no es cómo el código hace su trabajo, sino *quién* puede pedirle que trabaje. Al exponer endpoints (`/api/research`) que desencadenan flujos asíncronos complejos y de alto costo (llamadas a Nebius, Linkup, y Workflows en Render) sin ninguna capa de autenticación, autorización o control de cuotas, has creado una vulnerabilidad clásica de Denegación de Billetera (Denial of Wallet). 

Además, tu manejo de errores en el flujo principal (`/api/triage`) es contraproducente. Por ocultar la complejidad al usuario, el bloque `catch` superior se traga las excepciones por completo. Si el sistema colapsa, lo hará en un silencio absoluto, dejándote ciego en medio de un incidente.

Es un sistema que funciona maravillosamente bajo un microscopio de pruebas e2e, pero que está arquitectónicamente indefenso frente a la hostilidad de la internet abierta. No es mediocre, es simplemente peligroso.

## Scorecard

| Dimension | Weight | Score | Evidence summary |
| :--- | :--- | :--- | :--- |
| Arquitectura y separación | 12 | 10 | Excelente desacoplamiento. APIs finas, lógica de dominio pura y buena delegación al orquestador. |
| Modelo de datos e integridad | 12 | 10 | Esquemas sólidos, índices únicos, y constraints bien modelados (ej. `ON CONFLICT DO NOTHING`). |
| Seguridad y Auth | 15 | 0 | **(CRITICAL)** Endpoints que consumen LLMs de pago y Workflows no tienen validación de identidad ni rate limits. |
| API y contratos | 10 | 8 | Zod validation robusto en la entrada y en las respuestas del LLM, pero permite IDOR en lectura/escritura de UUIDs. |
| Reliability y manejo de fallos | 12 | 8 | Recuperabilidad asombrosa por diseño (reintentos de pasos). Penalizado por tragarse excepciones. |
| Performance y escalabilidad | 8 | 6 | Connection pool (`max: 5`) es un cuello de botella inminente. |
| Observabilidad y operación | 8 | 4 | Nula visibilidad en caso de errores fuera de `generateStructured`. Triage devuelve 502 en silencio. |
| Tests y confidence engineering | 10 | 10 | Tests `e2e` excepcionales probando el comportamiento real de las carreras y la idempotencia. |
| Deployment safety | 8 | 5 | Blueprint funcional, pero sin protecciones sistémicas de blast radius (rate limits de infraestructura). |
| Mantenibilidad | 5 | 4 | Código claro, comentarios que explican el *porqué* sistémico de forma ejemplar. |

*(Nota: Aunque la suma bruta es 65, se aplicó un CAP de 49 por vulnerabilidad crítica explotable).*

## Top 10 findings

1. **(CRITICAL) Unauthenticated API / Denial of Wallet** 
   - **Evidence:** `app/api/research/route.ts` acepta peticiones `POST` anónimas (`anonymous: true`) que desencadenan trabajos en Render Workflows y consumen Linkup/Nebius. No hay *rate limiting*.
   - **Why it matters:** Un solo script malicioso puede agotar tus créditos de APIs externas en minutos.
   - **Failure scenario:** Un ataque con 100 req/s inunda tu Render y Nebius. Las facturas se disparan y los usuarios reales reciben HTTP 429.
   - **Fix direction:** Implementar un middleware de rate-limiting estricto (por IP/Cookie) o forzar un challenge (reCAPTCHA/Turnstile) para el flujo público.

2. **(HIGH) Errores letales tragados en silencio absoluto** 
   - **Evidence:** `app/api/triage/route.ts:144`. El bloque `catch` final asume cualquier error y devuelve un HTTP 502, pero *nunca* imprime el error a la consola.
   - **Why it matters:** Si la base de datos rechaza la conexión, o si hay un error de runtime inesperado, nunca verás el stack trace ni sabrás qué falló. 
   - **Failure scenario:** Un despliegue rompe un import o una variable de entorno. Todos los usuarios ven "No se pudo procesar...", y los logs de Render están completamente vacíos.
   - **Fix direction:** `console.error('[triage] Fallo crítico:', error)` antes de retornar el 502.

3. **(HIGH) IDOR (Insecure Direct Object Reference) en las investigaciones**
   - **Evidence:** `GET /api/research?runId=...` y la reanudación en `POST` no verifican propiedad de la sesión. 
   - **Why it matters:** Aunque los UUIDv4 son inofensivos de predecir, filtrarlos por error compromete datos privados del usuario. 
   - **Failure scenario:** El log de un proxy o un share accidental expone el UUID. Cualquiera puede leer o re-disparar una investigación ajena.
   - **Fix direction:** Ligar el `runId` a una cookie de sesión anónima obligatoria y validar propiedad al consultar.

4. **(HIGH) Connection Pool asfixiante por defecto**
   - **Evidence:** `lib/db.ts:14`. El pool de `pg` está limitado a `max: 5` conexiones.
   - **Why it matters:** Un pool de 5 conexiones compartidas entre las rutas síncronas de la API y los workers asíncronos de Render se saturará instantáneamente bajo carga.
   - **Failure scenario:** 6 jueces hacen click a la vez. El sexto sufre un Timeout de conexión, y por el Hallazgo #2, simplemente obtiene un 502 mudo.
   - **Fix direction:** Aumentar razonablemente el `max` a `20` o usar connection pooling en Render (PgBouncer).

5. **(MEDIUM) Carrera silenciosa en el orquestador de respaldo**
   - **Evidence:** `app/api/research/route.ts:44`. Si Render falla al iniciar, el proceso hace `void advanceResearch(runId).catch(...)`. Retorna HTTP 202 al cliente antes de saber si la DB local al menos aceptó iniciar.
   - **Why it matters:** Falsa promesa de ejecución.
   - **Failure scenario:** Render cae. El local executor falla sincrónicamente al iniciar la DB. El usuario ve "Investigando..." pero el proceso murió.
   - **Fix direction:** Hacer un `await` del primer insert/update antes de devolver 202, asegurando que está en la DB.

6. **(MEDIUM) Resurrección zombi de tareas por error**
   - **Evidence:** Si un micro-paso asíncrono se cae con una excepción antes de actualizar su `run_steps` a `done`, Render Workflows lo reintentará desde cero y re-ejecutará todo el `work()` interno.
   - **Why it matters:** LLM calls duplicadas de la misma fase desperdician dinero (aunque la inserción final evite duplicados gracias al `ON CONFLICT`).
   - **Fix direction:** El diseño de la idempotencia aquí es mayormente sólido (el `RETURNING step` previene que *dos workers* compitan), pero el fallo tardío sigue repitiendo el trabajo de inferencia. Aceptable pero mejorable.

## What looks better than it actually is

**El orquestador en segundo plano (Render Workflows + Fallback Local)**.
Superficialmente, la infraestructura asíncrona parece una obra maestra de ingeniería para delegar tareas lentas de IA a workers. Sin embargo, no resiste el análisis adversarial: has diseñado una tubería industrial de alta presión y la conectaste a un grifo público. La sofisticación del backend sólo logra que la máquina sea ultra-eficiente para destruir tu límite de facturación. Es un exceso de ceremonia ingenieril en la capa de ejecución mientras la puerta principal no tiene cerradura.

## What is genuinely good

1. **La barrera de idempotencia de los steps**. El esquema y el uso de `ON CONFLICT (run_id, step)` y la verificación estricta de `StepBusyError` son defensas brillantes. Garantizan que pase lo que pase en la red, jamás le insertarás hallazgos duplicados al usuario.
2. **Confidence Engineering Realista.** El diseño E2E (`tests/research.e2e.mjs`) que *literalmente* simula carreras de condición forzadas para ver si la base de datos sangra. Esto es ingeniería superior y raramente se ve en un MVP.
3. **Modelado de Estado Restrictivo**. Que `runs.ok` empiece en `false` por defecto en la BD y tenga que probar su éxito al final de la corrida elimina una familia entera de bugs lógicos por omisión de error.

## Production incident prediction

1. **La pesadilla del Bot**
   - **Trigger:** Alguien encuentra el endpoint público `/api/research` y corre un `while true` cURL.
   - **Failure:** Se encolan miles de workflows en Render, disparando llamadas paralelas a Nebius y Linkup.
   - **Impact:** Tu cuenta de Nebius agota saldo. Facturación sorpresa en Render y parálisis total para usuarios legítimos (HTTP 429).
   - **Detection:** Tarde (aviso por email de límite de facturación al 100%).
   - **Recovery Difficulty:** Alta. Tienes que revocar llaves API en la madrugada y borrar manualmente miles de trabajos de la BD.

2. **El "Silencio de los Inocentes" (Fallo Triage)**
   - **Trigger:** Una caída temporal de la API de Nebius, o un cambio en el formato de salida, dispara una excepción inesperada.
   - **Failure:** El `catch` superior en el route handler se traga el error y retorna 502 sin loggear el stack.
   - **Impact:** El servicio parece roto para el cliente, pero los métricas de servidor muestran cero errores impresos.
   - **Detection:** Solo te enterarás porque un usuario se queja. Mirarás los logs y no habrá nada.
   - **Recovery Difficulty:** Moderada, pero requerirá debugear a ciegas en producción parcheando logs temporalmente para ver qué está pasando.

3. **Asfixia de DB por Concurrencia**
   - **Trigger:** Un juez o influencer comparte el link. 20 usuarios entran simultáneamente.
   - **Failure:** El connection pool de PostgreSQL (max 5) se agota. Las peticiones a `/api/triage` (que abren la BD para autorizar o escribir) hacen timeout en el driver.
   - **Impact:** Todos los usuarios experimentan lentitud extrema o fallos 502 de inmediato.
   - **Detection:** Logs de Render "Timeout Error" del módulo `pg`.
   - **Recovery Difficulty:** Fácil (aumentar `max`), pero destruye la demo en el momento exacto en que más importaba.

## Technical debt vs structural debt

- **Cosas reparables (Technical Debt):** 
  - Tragar errores en el `catch`. Un `console.error` de una línea lo resuelve.
  - Connection Pool en `5`. Un cambio de configuración de una línea.

- **Decisiones estructurales (Structural Debt):** 
  - La falta de Auth/Rate Limiting estricto. La arquitectura confía en que los "flujos sin cuenta" no escalarán. Reparar esto requiere introducir un gestor de tokens o de rate limit ligado a cookies por IP para todo el servicio público.

## Mediocrity test

"This backend is **NOT** mediocre because su núcleo asume de manera pesimista el fracaso de la red, garantizando resiliencia e integridad de datos a un nivel superior al de muchos sistemas empresariales (el uso táctico de los bloqueos a nivel DB y E2E es prueba irrefutable de ello). Sin embargo, está arquitectónicamente INCOMPLETO y actualmente es PELIGROSO de desplegar en abierto porque la sofisticación de su motor es inútil frente a la total ausencia de un portero que regule quién enciende el coche."

## Priority

**P0 — Fix before trusting the system**
- Imprime los errores en los bloques `catch` de `app/api/triage/route.ts`. Sin esto eres ciego.
- Implementa *Rate Limiting* (vía un Middleware de Next.js u origin firewall) para `/api/research`. No puedes dejar un endpoint de gasto LLM abierto al mundo.

**P1 — Fix before meaningful growth**
- Sube el Pool de PostgreSQL a 20 o configúralo con PgBouncer en Render.
- Evita el IDOR verificando que quien hace `GET /api/research` fue el que creó la sesión (cookie validación).

**P2 — Quality improvement**
- Await the `dispatchResearch` local fallback to ensure the DB write succeeds before responding 202.

**P3 — Nice to have**
- Alarmas proactivas de gasto en Nebius/Render.

---

### Conclusión
**SHIP WITH CONDITIONS**

El código tiene el rigor formal necesario para sostener el producto durante la hackathon y los jueces no tirarán el sistema. Sin embargo, no debes anunciar ni promover la URL `domi-web.onrender.com` públicamente sin advertir el riesgo hasta que añadas un rate limiter rudimentario (ej. un middleware que asocie un máximo de X llamadas por IP/Cookie). El riesgo de que alguien corra un script y consuma los tokens no es un fallo hipotético; es una vulnerabilidad garantizada en internet. Haz esa mitigación y envíalo con confianza.
