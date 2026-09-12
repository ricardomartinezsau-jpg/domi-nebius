# Domi — Brain Dump Triage (Nebius Token Factory)

Suelta un vaciado mental caótico y recibe, en dos llamadas a **Gemma 3 27B**
(`google/gemma-3-27b-it`) servido por **Nebius Token Factory**:

1. **Fase rápida (~3,6 s):** las tareas repartidas en 4 bandejas de vida y un primer
   movimiento de arranque de 2 a 5 minutos — lo que la persona necesita para moverse.
2. **Fase de detalle (llega sola, ~8,2 s en total):** el orden real de dependencias y
   cada tarea grande partida en micro-pasos de 2 a 10 minutos.

Está partido en dos a propósito: pedir todo en una sola respuesta tardaba entre 9 y 20
segundos según el modelo. Para alguien con TDAH o disfunción ejecutiva, veinte segundos
frente a una pantalla en blanco es donde se pierde la sesión.

Este es el build mínimo y público hecho para la hackathon **Burning Tokens** (track
Applied AI — Nebius). Es una arquitectura propia y deliberadamente chica: usa como
referencia un producto privado más grande, pero no es una copia de él — ver
[AGENTS.md](AGENTS.md) para el porqué.

## Probarlo

Sin cuenta, sin login: **https://domi-web.onrender.com**

Es un plan básico de Render: si lleva rato sin usarse, la primera carga puede tardar unos
segundos en despertar.

## Correrlo local

```bash
npm install
cp .env.example .env.local   # y pega tu NEBIUS_API_KEY ahí
npm run dev
# abrir http://localhost:3000
```

El flujo del vaciado necesita **solo** `NEBIUS_API_KEY`. Las demás variables de
`.env.example` pertenecen a capas que todavía no están conectadas a esta pantalla; puedes
dejarlas vacías.

## Cómo está armado

- `lib/nebius.ts` — la integración con Nebius Token Factory: endpoint, modelo, timeout de
  60s, y un único punto donde se pueden filtrar errores del SDK antes de que lleguen a
  logs o al usuario.
- `lib/triage.ts` — el contrato del producto: el esquema Zod de las 4 bandejas, el orden
  de dependencias, las micro-tareas y el modo momentum, más el prompt que se lo pide al
  modelo.
- `app/api/triage/route.ts` — la única ruta de producto. Valida la entrada (1 a 4000
  caracteres) antes de gastar un solo token, y resuelve las dos fases.
- `components/` — la UI: el vaciado (texto y voz) y la vista de resultado. El flujo
  público no guarda nada en el servidor: cada envío es independiente.

## Evaluación

```bash
node tests/eval.mjs --self-test   # sin red, valida la rúbrica y el manejo de errores
node tests/eval.mjs --dry-run     # arma las 5 solicitudes reales, sin llamarlas
NEBIUS_API_KEY=tu_clave node tests/eval.mjs   # corrida real: mide latencia, costo y rúbrica
```

Resultados de la última corrida real, metodología y el caso de dificultad:
[EVALUATION.md](EVALUATION.md).

## Qué mide "bueno" aquí

No solo "el JSON tiene la forma correcta". Cada caso de prueba trae una rúbrica
determinística propia (ej.: "el primer paso de la secuencia no depende de nada pendiente",
"cada micro-paso dura entre 2 y 10 minutos y trae un primer clic concreto"). El modelo por
defecto se eligió midiendo cuatro candidatos occidentales sobre los mismos cinco casos, no
por reputación. Ver [EVALUATION.md](EVALUATION.md) para el detalle y para el caso donde el
modelo tiene dificultades reales.
