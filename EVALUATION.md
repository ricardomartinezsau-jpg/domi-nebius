# Evaluación Nebius — Domi

Fecha: 2026-09-11T23:40:09.568Z. Modelo: `google/gemma-3-27b-it`.

## Qué se mide y por qué

El producto hace **dos** llamadas, no una: la **fase rápida** devuelve las 4 bandejas y
el arranque —lo que la persona ve y con lo que actúa— y la **fase de detalle** devuelve la
secuencia de dependencias y los micro-pasos. Se partió así después de medir: pedir todo en
una sola respuesta daba entre 9 y 20 segundos según el modelo, y uno de los candidatos se
quedaba sin espacio de salida a media frase. Para alguien con disfunción ejecutiva, veinte
segundos frente a una pantalla en blanco es donde se pierde la sesión.

La rúbrica es determinística por caso (no un segundo modelo juzgando al primero), inspirada
en el patrón de evaluación pointwise del notebook `day-1-evaluation-and-structured-output`
del curso de GenAI de Google/Kaggle. Se eligió así a propósito: es gratis, reproducible, y
cada aprobación se puede señalar con el dedo en el código que la verificó.

Evidencia completa y reproducible: [`2026-09-11T23-40-09-568Z-46b4ccb8.json`](evaluation-evidence/2026-09-11T23-40-09-568Z-46b4ccb8.json).

## Mediciones

| Métrica | Resultado | Alcance |
| --- | --- | --- |
| Casos que pasan contrato + rúbrica | 5/5 | No equivale a precisión semántica completa |
| Conformidad de esquema | 5/5 | Contrato estructural de ambas fases |
| **Latencia de la fase rápida** | **3578 ms** | Lo que la persona espera mirando; objetivo <5000 ms: Cumple objetivo |
| Latencia total (ambas fases) | 8241 ms | La segunda fase llega cuando ya arrancó |
| Costo medio por vaciado | $0.000346 USD | Suma de las dos llamadas |

Los precios de referencia ($0.13/M entrada,
$0.4/M salida) **no están verificados** contra la
tarifa vigente y no representan facturación real.

## Resultados por caso

### Caso 1: Parálisis por análisis (multi-bandeja)

- Estado: PASA · rápida: 4807 ms · detalle: 6195 ms · total: 11002 ms.
- Tokens: 689 entrada / 798 salida · costo estimado: $0.000409 USD.
- Arranque observado: Bebe un vaso de agua \*lento\*. Enfócate solo en la sensación del agua. 2 minutos..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Bandeja esperada no vacía: personalBienestar.
- PASA: Bandeja esperada no vacía: profesionalProductiva.
- PASA: Bandeja esperada no vacía: familiarDomestica.
- PASA: Bandeja esperada no vacía: socialComunitaria.

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 2: Trampa de hiperfoco en actividad de cueva

- Estado: PASA · rápida: 3666 ms · detalle: 5599 ms · total: 9265 ms.
- Tokens: 682 entrada / 754 salida · costo estimado: $0.000390 USD.
- Arranque observado: Bebe un vaso de agua \*lentamente\*. Fíjate en la sensación del agua al bajar. 2 minutos..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Existe al menos una trampa de dopamina descrita (proxy estructural).

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 3: Cadena de dependencias

- Estado: PASA · rápida: 2712 ms · detalle: 5506 ms · total: 8218 ms.
- Tokens: 663 entrada / 688 salida · costo estimado: $0.000361 USD.
- Arranque observado: Bebe un vaso de agua. Literalmente, levántate y bebe un vaso de agua..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Secuencia numerada 1..N con tarea y razón no vacías.
- PASA: El primer paso no depende de nada pendiente.

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 4: Tarea monstruo que requiere micro-pasos

- Estado: PASA · rápida: 3526 ms · detalle: 1471 ms · total: 4997 ms.
- Tokens: 628 entrada / 408 salida · costo estimado: $0.000245 USD.
- Arranque observado: Bebe un vaso de agua \*lentamente\*. Fíjate en la sensación del agua al bajar. 2 minutos..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.
- PASA: Micro-tareas y pasos no vacíos.
- PASA: Micro-pasos de 2 a 10 minutos.
- PASA: Cada micro-paso tiene título y hook (proxy estructural).

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada.

### Caso 5: Caso de dificultad — colapso sensorial vs. deber externo

- Estado: PASA · rápida: 3178 ms · detalle: 4544 ms · total: 7722 ms.
- Tokens: 686 entrada / 588 salida · costo estimado: $0.000324 USD.
- Arranque observado: 5 respiraciones profundas. Inhala contando hasta 4, exhala contando hasta 6. Solo eso. Nada más..
- PASA: Hook de activación no vacío.
- PASA: Escudo de foco no vacío.

Revisión humana pendiente: Clasificación semántica real de cada ítem (esto solo confirma que las listas no están vacías). Utilidad y tono percibidos por una persona real; eficacia clínica no evaluada. Caso de dificultad: revisar si prioriza regular el cuerpo sobre la entrega. Las notas del fixture son hipótesis, no observaciones.

## Caso de dificultad

**case-05-struggle-case-burnout**: la persona describe parálisis por sobrecarga sensorial
("mi cabeza va a mil por hora... no puedo respirar bien") junto a un compromiso externo
("prometí entregar el reporte de ventas hoy a las 5pm"). El riesgo medido no es que el JSON
salga mal: es que el modelo empuje la entrega por encima del estado de la persona. Por eso
existe una regla determinística fuera del modelo (`somatic-override` en `lib/verify.ts`)
que rechaza el resultado si detecta señales de colapso físico y el arranque no regula el
cuerpo primero. El resultado completo de cada corrida queda en la evidencia para revisión
humana.

## Límites y reproducción

5 fixtures sintéticos, en secuencia, sin reintentos, máximo 4096
tokens por llamada y 60000 ms de espera. Se reutiliza `lib/triage.ts` real (mismos
prompts y esquemas que la app), no una copia. No cubre percepción de utilidad ni latencia
end-to-end del navegador.

Sin red: `node tests/eval.mjs --self-test` y `node tests/eval.mjs --dry-run`.
Con la API real: `NEBIUS_API_KEY=... node tests/eval.mjs [--model=<id>]`.
Código de salida: 0 si todo pasa, 1 si algo falla, 2 si falta configuración.
