# Pasada final verificable — 13 de septiembre de 2026

## Entrada pública

- URL: https://domi-web.onrender.com
- Web desplegada al cierre: `5cd638640804c69affedfdfadb68f2b7daaa83b8`, deploy `dep-dajoirdckfvc73a0pjrg`, estado `live`.
- Workflow desplegado al cierre: `domi-research`, versión `5cd6386`, estado `ready`, `main`, `npm install` y `npm run start:workflows`.
- La corrida de demostración usó la versión `68704cf` —el commit que incorporó el fallo controlado y la ruta de investigación—; el commit actual es su descendiente y sólo añadió limpieza de secretos/encabezados.

## Configuración Render y migración viva

- Web: presentes `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `DOMI_ADMISSION_ENABLED=true`, `LINKUP_API_KEY`, `NEBIUS_API_KEY`, `RENDER_API_KEY` y `RENDER_WORKFLOW_SLUG=domi-research`.
- Workflow: presentes `DATABASE_URL`, `DOMI_ADMISSION_ENABLED`, `LINKUP_API_KEY` y `NEBIUS_API_KEY`. Los valores permanecieron ocultos en la captura del dashboard.
- La compuerta de demo terminó segura: `DOMI_DEMO_FAULT_ENABLED=false`; el token temporal ya no existe en el web service.
- Log de arranque de `domi-research`: base de datos alcanzable en 23 ms; no hubo error SQL.
- Migración `0007_admission_and_execution.sql`: aplicada el `2026-09-13T23:22:14.769Z`, con SHA-256 `9ac762371eb9f637bac8531b1063a6315341cc02f719c5912113886ee441a379`, igual al archivo actual. Las siete columnas nuevas de `runs` y `run_steps.generation` están presentes.

## Corrida Render + Linkup

- Hora local de inicio: 13 de septiembre, 23:38:50 CDT (UTC `2026-09-14T05:38:50.565Z`).
- `runId`: `5cd6e72d-bec3-413b-bc6a-da1e1b6ff72b`.
- Root task run: `trn-0b94gdajogqmk1f9s738qpti0`.
- Correlation/request ID: `507419ed-9806-4cb6-921d-07a89c6f9b53`.
- Resultado: `done`, `dispatchState: accepted`, generación `1`; el root run terminó `Succeeded` en 27.5 s.

## Recuperación sin duplicados

El fallo se autorizó temporalmente sólo para este run, se insertó después de persistir `search-1`, y la compuerta se cerró inmediatamente después de aceptar el run. Render registra el mismo task run `trn-0b94gdajogspsbvag00e8295g` con:

1. intento 1: `failed`, `RESEARCH_STEP_FAILED`, a las `05:38:59.996831Z`;
2. intento 2: `completed`, a las `05:39:01.672448Z`.

El ledger PostgreSQL quedó con seis filas únicas: `question-1`, `search-1`, `demo-fault` (intento 2, `recovered: true`), `gap`, `search-2` y `guide`. `search-1` quedó en intento 1. No se hizo una segunda llamada de ese paso.

## Investigación Linkup visible

La captura `04-research-sources.png` se tomó del producto desplegado con la misma sesión invitada del run. Muestra dos preguntas, 8 hallazgos guardados de la ronda 1, 8 de la ronda 2, citas por paso y el bloque de incertidumbres.

## Recarga y cierre seguro

Tras cargar de nuevo la pantalla y hacer un GET autenticado del mismo run, la respuesta siguió siendo `done` con 6 pasos, 2 preguntas y 16 fuentes. La consulta de duplicados por `(round, source_url)` devolvió cero filas. La configuración temporal terminó como `DOMI_DEMO_FAULT_ENABLED=false` y `DOMI_DEMO_FAULT_TOKEN` ausente del servicio web.

## Nebius

La evaluación autorizada inició a las 23:28:45 CDT y está en `EVALUATION.md` y el JSON de evidencia. Mide los cinco fixtures con `google/gemma-3-27b-it` en la fase rápida y `openai/gpt-oss-120b` en detalle: 5/5 pasan contrato y rúbrica; media rápida 7356 ms, detalle 4669 ms, total 12025 ms y costo estimado medio $0.001093 USD. Las tarifas se etiquetan como no verificadas, no como facturación de Nebius.

## Comprobación pública posterior

El 14 de septiembre a las `06:42:46.710Z`, una sesión invitada recién emitida en la URL pública completó las dos fases del endpoint desplegado sin cuenta. La fase rápida respondió `200` con `google/gemma-3-27b-it` en 15146 ms (`ab503516-f509-4197-af3d-85c07e260f15`) y la fase de detalle respondió `200` con `openai/gpt-oss-120b` en 9638 ms (`9b0d1c12-1ca0-4f24-bd07-a88fca65de10`). Ninguna regla de salida falló. El resumen saneado, sin cookie ni texto de la persona, está en `../2026-09-14/07-public-triage-anonymous.json`; corresponde al commit desplegado `b7dec3f4df5a4ab15044e01b27cc3ab7afffe05c`.
