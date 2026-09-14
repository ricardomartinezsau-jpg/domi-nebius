# Pasada final verificable — 13 de septiembre de 2026

## Entrada pública

- URL: https://domi-web.onrender.com
- Web desplegada al cierre: `5cd638640804c69affedfdfadb68f2b7daaa83b8`, deploy `dep-dajoirdckfvc73a0pjrg`, estado `live`.
- Workflow desplegado al cierre: `domi-research`, versión `5cd6386`, estado `ready`, `main`, `npm install` y `npm run start:workflows`.
- La corrida de demostración usó la versión `68704cf` —el commit que incorporó el fallo controlado y la ruta de investigación—; el commit actual es su descendiente y sólo añadió limpieza de secretos/encabezados.

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
