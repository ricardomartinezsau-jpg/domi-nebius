# Evaluación Nebius — Domi

Fecha: 2026-09-14T06:49:21.161Z. Fase rápida: `google/gemma-3-27b-it`. Fase de detalle: `openai/gpt-oss-120b`.

## Qué se mide y por qué

El producto hace **dos** llamadas, no una: la **fase rápida** devuelve las 4 bandejas y
el arranque —lo que la persona ve y con lo que actúa— y la **fase de detalle** devuelve la
secuencia de dependencias y los micro-pasos. Se partió así después de medir: pedir todo en
una sola respuesta daba entre 9 y 20 segundos según el modelo, y uno de los candidatos se
quedaba sin espacio de salida a media frase. Para alguien con disfunción ejecutiva, veinte
segundos frente a una pantalla en blanco es donde se pierde la sesión.

Esta corrida reproduce los modelos que sirve el producto: `google/gemma-3-27b-it` para el triage
visible y `openai/gpt-oss-120b` para el detalle. Cada request y cada resultado conserva el
modelo, tokens, latencia y estimación de costo de su propia fase; no se aplica una sola tarifa
a dos modelos distintos.

La rúbrica es determinística por caso (no un segundo modelo juzgando al primero), inspirada
en el patrón de evaluación pointwise del notebook `day-1-evaluation-and-structured-output`
del curso de GenAI de Google/Kaggle. Se eligió así a propósito: es gratis, reproducible, y
cada aprobación se puede señalar con el dedo en el código que la verificó.

Evidencia completa y reproducible: [`2026-09-14T06-49-21-161Z-4743a228.json`](evaluation-evidence/2026-09-14T06-49-21-161Z-4743a228.json).

## Mediciones

| Métrica | Resultado | Alcance |
| --- | --- | --- |
| Casos que pasan contrato + rúbrica | 5/5 | No equivale a precisión semántica completa |
| Conformidad de esquema | 5/5 | Contrato estructural de ambas fases |
| **Latencia rápida — `google/gemma-3-27b-it`** | **9608 ms** | 5/5 respuestas completas; objetivo <5000 ms: No cumple objetivo |
| Latencia detalle — `openai/gpt-oss-120b` | 8402 ms | 5/5 respuestas completas; llega en segundo plano |
| Latencia total (ambas fases) | 18010 ms | 5/5 casos con las dos fases evaluables |
| Costo medio rápido | $0.000170 USD | Cobertura de costo: 5/5 |
| Costo medio detalle | $0.000972 USD | Cobertura de costo: 5/5 |
| Costo medio por vaciado | $0.001141 USD | Suma de ambas fases; cobertura: 5/5 |

Tarifas de referencia por fase (una estimación no sustituye la facturación de Nebius):

- `google/gemma-3-27b-it`: $0.13/M entrada y $0.4/M salida (no verificada; baseline histórico del evaluador; la tarifa vigente debe verificarse antes de atribuir facturación real).
- `openai/gpt-oss-120b`: $0.15/M entrada y $0.6/M salida (no verificada; https://nebius.com/token-factory/prices (base; referencia consultada 2026-09-13, confirmar antes de atribuir facturación real)).

## Resultados por caso

### Caso 1: Parálisis por análisis (multi-bandeja)

- Estado: PASA · rápida: 10918 ms · detalle: 11014 ms · total: 21932 ms.
- Rápida — `google/gemma-3-27b-it`: 649 entrada / 247 salida · 10918 ms · costo: $0.000183 USD.
- Detalle — `openai/gpt-oss-120b`: 405 entrada / 1885 salida · 11014 ms · costo: $0.001192 USD.
- Total: 1054 entrada / 2132 salida · costo estimado: $0.001375 USD.
- Arranque observado: bebe un vaso de agua y respira profundo tres veces..
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · hook-is-one-action.
- PASA: Regla dura · hook-not-empty.
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · micro-steps-present.
- PASA: Regla dura · step-budget.
- PASA: Regla dura · decomposition-budget.
- PASA: Regla dura · first-step-startable.
- PASA: Regla dura · sequence-numbered.
- PASA: Regla dura · hooks-concrete.
- PASA: Regla dura · grounded-has-source.
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Bandeja esperada no vacía: personalBienestar.
- PASA: Bandeja esperada no vacía: profesionalProductiva.
- PASA: Bandeja esperada no vacía: familiarDomestica.
- PASA: Bandeja esperada no vacía: socialComunitaria.

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 2: Trampa de hiperfoco en actividad de cueva

- Estado: PASA · rápida: 13758 ms · detalle: 6005 ms · total: 19763 ms.
- Rápida — `google/gemma-3-27b-it`: 645 entrada / 189 salida · 13758 ms · costo: $0.000159 USD.
- Detalle — `openai/gpt-oss-120b`: 404 entrada / 977 salida · 6005 ms · costo: $0.000647 USD.
- Total: 1049 entrada / 1166 salida · costo estimado: $0.000806 USD.
- Arranque observado: bebe un vaso de agua y pon una canción que te guste..
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · hook-is-one-action.
- PASA: Regla dura · hook-not-empty.
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · micro-steps-present.
- PASA: Regla dura · step-budget.
- PASA: Regla dura · decomposition-budget.
- PASA: Regla dura · first-step-startable.
- PASA: Regla dura · sequence-numbered.
- PASA: Regla dura · hooks-concrete.
- PASA: Regla dura · grounded-has-source.
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Existe al menos una trampa de dopamina descrita (proxy estructural).

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 3: Cadena de dependencias

- Estado: PASA · rápida: 8978 ms · detalle: 9612 ms · total: 18590 ms.
- Rápida — `google/gemma-3-27b-it`: 638 entrada / 215 salida · 8978 ms · costo: $0.000169 USD.
- Detalle — `openai/gpt-oss-120b`: 397 entrada / 1857 salida · 9612 ms · costo: $0.001174 USD.
- Total: 1035 entrada / 2072 salida · costo estimado: $0.001343 USD.
- Arranque observado: bebe un vaso de agua y respira hondo 3 veces..
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · hook-is-one-action.
- PASA: Regla dura · hook-not-empty.
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · micro-steps-present.
- PASA: Regla dura · step-budget.
- PASA: Regla dura · decomposition-budget.
- PASA: Regla dura · first-step-startable.
- PASA: Regla dura · sequence-numbered.
- PASA: Regla dura · hooks-concrete.
- PASA: Regla dura · grounded-has-source.
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Secuencia numerada 1..N con tarea y razón no vacías.
- PASA: El primer paso no depende de nada pendiente.

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 4: Tarea monstruo que requiere micro-pasos

- Estado: PASA · rápida: 6480 ms · detalle: 7170 ms · total: 13650 ms.
- Rápida — `google/gemma-3-27b-it`: 618 entrada / 210 salida · 6480 ms · costo: $0.000164 USD.
- Detalle — `openai/gpt-oss-120b`: 376 entrada / 1405 salida · 7170 ms · costo: $0.000899 USD.
- Total: 994 entrada / 1615 salida · costo estimado: $0.001064 USD.
- Arranque observado: bebe un vaso de agua y pon una canción que te guste..
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · hook-is-one-action.
- PASA: Regla dura · hook-not-empty.
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · micro-steps-present.
- PASA: Regla dura · step-budget.
- PASA: Regla dura · decomposition-budget.
- PASA: Regla dura · first-step-startable.
- PASA: Regla dura · sequence-numbered.
- PASA: Regla dura · hooks-concrete.
- PASA: Regla dura · grounded-has-source.
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Micro-tareas y pasos no vacíos.
- PASA: Micro-pasos de 2 a 10 minutos.
- PASA: Cada micro-paso tiene título y hook (proxy estructural).

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 5: Caso de dificultad — colapso sensorial vs. deber externo

- Estado: PASA · rápida: 7906 ms · detalle: 8207 ms · total: 16113 ms.
- Rápida — `google/gemma-3-27b-it`: 646 entrada / 222 salida · 7906 ms · costo: $0.000173 USD.
- Detalle — `openai/gpt-oss-120b`: 400 entrada / 1478 salida · 8207 ms · costo: $0.000947 USD.
- Total: 1046 entrada / 1700 salida · costo estimado: $0.001120 USD.
- Arranque observado: bebe un vaso de agua y cuenta hasta diez..
- PASA: Regla dura · somatic-override.
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · hook-is-one-action.
- PASA: Regla dura · hook-not-empty.
- PASA: Regla dura · no-schema-leak.
- PASA: Regla dura · no-markup.
- PASA: Regla dura · no-shouting.
- PASA: Regla dura · micro-steps-present.
- PASA: Regla dura · step-budget.
- PASA: Regla dura · decomposition-budget.
- PASA: Regla dura · first-step-startable.
- PASA: Regla dura · sequence-numbered.
- PASA: Regla dura · hooks-concrete.
- PASA: Regla dura · grounded-has-source.
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada. Caso de dificultad: la regla somatic-override se comprueba abajo; lo que queda a revisión humana es si la acción propuesta es adecuada para esta persona, no si regula el cuerpo.

## Caso de dificultad

**case-05-struggle-case-burnout**: la persona describe parálisis por sobrecarga sensorial
("mi cabeza va a mil por hora... no puedo respirar bien") junto a un compromiso externo
("prometí entregar el reporte de ventas hoy a las 5pm"). El riesgo medido no es que el JSON
salga mal: es que el modelo empuje la entrega por encima del estado de la persona. Por eso
existe una regla determinística fuera del modelo (`somatic-override` en `lib/verify.ts`)
que rechaza el resultado si detecta señales de colapso físico y el arranque no regula el
cuerpo primero. Esa regla corre en los dos sitios: en esta rúbrica, como una comprobación
más de cada caso, y en `app/api/triage/route.ts` antes de que la persona vea nada. Si el
modelo insiste tras un intento de corrección, el arranque lo sustituye un texto fijo escrito
a mano: la garantía no depende de que el modelo obedezca. El resultado completo de cada
corrida queda en la evidencia para revisión humana.

## Límites y reproducción

5 fixtures sintéticos, en secuencia, sin reintentos, máximo 4096
tokens por llamada y 60000 ms de espera. Se reutiliza `lib/triage.ts` real (mismos
prompts y esquemas que la app), no una copia. No cubre percepción de utilidad ni latencia
end-to-end del navegador.

Sin red: `node tests/eval.mjs --self-test` y `node tests/eval.mjs --dry-run`.
Con la API real y los defaults del producto: `NEBIUS_API_KEY=... node tests/eval.mjs`.
Para una comparación explícita, usa `--quick-model=<id>` y/o `--detail-model=<id>`; el alias
`--model=<id>` fuerza ambas fases y deja de representar el flujo servido.
Código de salida: 0 si todo pasa, 1 si algo falla, 2 si falta configuración.
