# Domi — Brain Dump Triage (Nebius Token Factory)

Suelta un vaciado mental caótico y recibe, en una sola llamada a **Meta Llama 3.3 70B**
servido por **Nebius Token Factory**: las tareas repartidas en 4 bandejas de vida, el
orden real de dependencias, cada tarea grande partida en micro-pasos de 2 a 10 minutos, y
un primer movimiento de arranque de 2 a 5 minutos. Pensado para personas con TDAH o
disfunción ejecutiva que se congelan frente a una lista larga y sin orden.

Este es el build mínimo y público hecho para la hackathon **Burning Tokens** (track
Applied AI — Nebius). Es una arquitectura propia y deliberadamente chica: usa como
referencia un producto privado más grande, pero no es una copia de él — ver
[AGENTS.md](AGENTS.md) para el porqué.

## Probarlo

Sin cuenta, sin login: [URL de despliegue en Render — se agrega al desplegar].

## Correrlo local

```bash
npm install
cp .env.example .env.local   # y pega tu NEBIUS_API_KEY ahí
npm run dev
# abrir http://localhost:3000
```

## Cómo está armado

- `lib/nebius.ts` — la integración con Nebius Token Factory: endpoint, modelo, timeout de
  60s, y un único punto donde se pueden filtrar errores del SDK antes de que lleguen a
  logs o al usuario.
- `lib/triage.ts` — el contrato del producto: el esquema Zod de las 4 bandejas, el orden
  de dependencias, las micro-tareas y el modo momentum, más el prompt que se lo pide al
  modelo.
- `app/api/triage/route.ts` — la única ruta de la app. Valida la entrada (1 a 4000
  caracteres) antes de gastar un solo token.
- `components/` — la UI: un formulario y la vista de resultado. Sin login, sin base de
  datos: cada envío es independiente.

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
"cada micro-paso dura entre 2 y 10 minutos y trae un primer clic concreto"). Ver
[EVALUATION.md](EVALUATION.md) para el detalle y para el caso donde el modelo tiene
dificultades reales.
