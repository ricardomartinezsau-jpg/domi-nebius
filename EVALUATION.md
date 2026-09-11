# Evaluación Nebius — Domi (MVP mínimo)

Fecha: 2026-09-11T23:20:13.914Z. Modelo: `openai/gpt-oss-120b`.

Metodología: rúbrica determinística por caso (no un segundo LLM como juez), inspirada en el
patrón de evaluación pointwise del notebook `day-1-evaluation-and-structured-output.ipynb`
del curso de 5 días de GenAI de Google/Kaggle. Se eligió determinística y no LLM-juez a
propósito: es gratis, reproducible bit a bit, y cada aprobación se puede explicar señalando
la línea de código que la verificó — más defendible ante un jurado que "otro modelo dijo que
está bien".

Evidencia completa de esta corrida: [`2026-09-11T23-20-13-914Z-0a10ab0e.json`](evaluation-evidence/2026-09-11T23-20-13-914Z-0a10ab0e.json)
(sin credenciales; incluye solicitudes, respuestas, fallos, uso de tokens y hashes de los
archivos evaluados).

## Mediciones

| Métrica | Resultado | Alcance |
| --- | --- | --- |
| Generaciones completas | 5/5 | HTTP 200 y finish_reason=stop |
| Latencia media | 9187 ms | objetivo <3500 ms: No cumple objetivo |
| Costo medio estimado | $0.000829 USD | Dentro de referencia; tarifa sin verificar |
| Conformidad de esquema (Zod) | 5/5 | Contrato estructural |
| Contrato + rúbrica determinística | 5/5 | No equivale a precisión semántica completa |

El costo usa precios de referencia sin verificar: $0.13/M
tokens de entrada y $0.4/M de salida. No representa
facturación real de la cuenta.

## Resultados por caso

### Caso 1: Parálisis por análisis (multi-bandeja)

- Estado: PASA · duración: 12301 ms · HTTP: 200.
- Tokens: 449 entrada / 2624 salida · costo estimado: $0.001108 USD.
- Hook de activación observado: Pon el cronómetro del móvil en 3 minutos, camina hasta la cocina y abre la nevera; ese pequeño movimiento rompe la inercia..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Bandeja esperada no vacía: personalBienestar.
- PASA: Bandeja esperada no vacía: profesionalProductiva.
- PASA: Bandeja esperada no vacía: familiarDomestica.
- PASA: Bandeja esperada no vacía: socialComunitaria.

Revisión humana pendiente: Clasificación semántica real de cada ítem del vaciado (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 2: Trampa de hiperfoco en actividad de cueva

- Estado: PASA · duración: 8112 ms · HTTP: 200.
- Tokens: 447 entrada / 1898 salida · costo estimado: $0.000817 USD.
- Hook de activación observado: Abre tu cliente de email, crea un nuevo mensaje y escribe solo la dirección del primer cliente (no envíes todavía). 2‑5 minutos, nada más..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Existe al menos una trampa de dopamina descrita (proxy estructural).

Revisión humana pendiente: Clasificación semántica real de cada ítem del vaciado (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 3: Cadena de dependencias

- Estado: PASA · duración: 6622 ms · HTTP: 200.
- Tokens: 439 entrada / 1669 salida · costo estimado: $0.000725 USD.
- Hook de activación observado: Abre Slack, entra al canal del equipo y escribe "Voy a tocar staging y prod en los próximos 30 min" (2 min)..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Secuencia numerada 1..N con tarea y razón no vacías.
- PASA: El primer paso no depende de nada pendiente (es el punto de partida real).

Revisión humana pendiente: Clasificación semántica real de cada ítem del vaciado (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 4: Tarea monstruo que requiere micro-pasos

- Estado: PASA · duración: 9612 ms · HTTP: 200.
- Tokens: 419 entrada / 1500 salida · costo estimado: $0.000654 USD.
- Hook de activación observado: Pon el temporizador del móvil a 5 min, abre Excel y escribe la palabra “INICIO” en la celda A1. Eso es todo lo que tienes que hacer para arrancar..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Micro-tareas y pasos no vacíos.
- PASA: Micro-pasos de 2 a 10 minutos.
- PASA: Cada micro-paso tiene título y hook (proxy estructural).

Revisión humana pendiente: Clasificación semántica real de cada ítem del vaciado (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 5: Caso de dificultad — colapso sensorial vs. deber externo

- Estado: PASA · duración: 9289 ms · HTTP: 200.
- Tokens: 446 entrada / 1951 salida · costo estimado: $0.000838 USD.
- Hook de activación observado: Pon tu teléfono en modo ‘No molestar’, cierra todas las pestañas del navegador excepto una, y escribe la palabra ‘START’ en un documento nuevo. Eso lleva menos de 2 min y ya estás en modo acción..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.

Revisión humana pendiente: Clasificación semántica real de cada ítem del vaciado (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada. Caso de dificultad: revisar manualmente si prioriza la regulación somática sobre la entrega. Las notas del fixture son una hipótesis, no una observación.

## Caso de dificultad

**case-05-struggle-case-burnout**: la persona describe parálisis por sobrecarga sensorial
("mi cabeza va a mil por hora... no puedo respirar bien") junto con un compromiso externo
("prometí entregar el reporte de ventas hoy a las 5pm"). No hay aserciones automáticas duras
para este caso — el resultado completo queda en la evidencia de esta corrida para revisión
humana: si el modelo prioriza la entrega sobre la regulación del estado de la persona, es una
falla de producto real aunque el JSON sea válido.

## Límites y reproducción

Se ejecutan 5 fixtures sintéticos, en secuencia, sin reintentos, con máximo
4096 tokens de salida y 60000 ms por llamada. Se reutiliza
`lib/triage.ts` real (mismo prompt y esquema que usa la app en producción, no una copia).
No cubre percepción de utilidad ni latencia end-to-end del navegador.

Validación local sin red: `node tests/eval.mjs --self-test` y `node tests/eval.mjs --dry-run`.
Para repetir con la API real: `NEBIUS_API_KEY=tu_clave node tests/eval.mjs`. Código de
salida: 0 si pasan todos los checks automáticos, 1 si alguno falla, 2 si falta configuración.
