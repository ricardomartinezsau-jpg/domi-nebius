# AGENTS.md — cómo trabajar en este repositorio

Este archivo es para **cualquier agente** que toque este código: Claude, Codex/OpenAI,
Google Antigravity, o el que siga. No es una nota para un modelo en particular — es la
carta de operación del repositorio.

## Qué es esto

`domi-nebius` es el build mínimo, público, para la hackathon **Burning Tokens** (track
Applied AI — Nebius Token Factory). Es la parte demostrable de un producto más grande y
privado, **Domi**, que existe aparte. Este repo **no es una copia** de ese producto: es
una arquitectura propia, deliberadamente más chica, construida usando ese producto y el
notebook de referencia `day-1-evaluation-and-structured-output.ipynb` (curso Google/Kaggle
de 5 días de GenAI) solo como **inspiración de patrones**, no como fuente para copiar y
pegar.

## Los tres principios que gobiernan cada decisión aquí

1. **Criterio antes que volumen.** Antes de escribir algo, tiene que estar claro qué
   problema concreto resuelve. Si no se puede explicar en una frase por qué existe un
   archivo, una dependencia o un campo del esquema, no entra.
2. **Menos deuda técnica.** Preferir un componente menos, aunque parezca "menos completo",
   sobre uno más que después nadie audita. Cada pieza que sí está —cuentas, base de datos,
   memoria— entró porque el producto no cumple su promesa sin ella, no porque estuviera
   disponible.
3. **Garantías formales antes que velocidad de escritura.** Manejo de errores explícito,
   validación de entradas, límites del sistema documentados y una evaluación que se pueda
   defender ante un desconocido — todo eso pesa más que llegar rápido a algo que "se ve
   que funciona" pero no se sabe por qué.

## Postura frente al Founder (Ricardo)

- Es el orquestador: dirige varios agentes en paralelo, decide dirección y prioridad. No
  escribe código a mano y no necesita leerlo para dar una decisión.
- El nivel de conversación con él es macro: qué se construye, por qué, qué arriesga, qué
  cuesta. El código y sus detalles se resuelven en este repo, no se le describen línea por
  línea.
- Aprender-haciendo es parte explícita del objetivo del proyecto, no solo "shippear algo
  hoy". Cuando una decisión técnica tenga una lección clara (por qué esta arquitectura y no
  otra, por qué esta métrica y no otra), vale la pena dejarla explícita en el código o en
  la documentación — no solo ejecutarla en silencio.

## Matriz de decisión: qué se ejecuta solo y qué necesita luz verde

**Ejecución autónoma (A2A / M2M):** instalar dependencias, correr `typecheck`, `build`,
`eval --dry-run` / `eval --self-test`, mover o renombrar archivos dentro de este repo,
formatear código, escribir documentación.

**Requiere decisión humana antes de avanzar (HITL):**
- Cambiar el esquema Zod de `lib/triage.ts` (es el contrato del producto).
- Cambiar de modelo, proveedor o endpoint de inferencia. Hoy: exclusivamente Nebius Token
  Factory con `google/gemma-3-27b-it`, y solo modelos de laboratorios occidentales. No hay
  fallback a otro proveedor a propósito, para que la integración con el patrocinador sea
  inequívoca.
- Correr `npm run eval` en modo real (consume la `NEBIUS_API_KEY` real y tiene costo,
  aunque sea mínimo).
- Cualquier push a `main` (este repo es público y `main` es lo que un juez va a ver y
  correr) y cualquier acción sobre el despliegue en Render.
- Editar el texto de la ficha de postulación de la hackathon o publicar en redes.

## Protocolo de diagnóstico ("zoom-in") cuando algo falla

1. Señalar con precisión el síntoma y el archivo/función donde vive la causa.
2. Explicar el porqué sistémico (qué garantía se está violando: validación, manejo de
   error, límite del esquema, contrato de tipos) — no solo "no funciona".
3. Mostrar el fallo antes de arreglarlo si la corrección implica una decisión de diseño,
   no un typo. Un error de sintaxis se corrige; un cambio de contrato se propone.

## Decisiones que ya se tomaron con datos (no volver a discutirlas sin medir)

- **Dos llamadas, no una.** Pedir bandejas, dependencias, micro-pasos y arranque en una sola
  respuesta daba 20 segundos con Gemma y dejaba a otros modelos sin espacio de salida. Partido
  en fase rápida (bandejas + arranque) y fase de detalle, la persona ve algo en ~3,6 s.
- **Máximo 3 tareas descompuestas.** Empezó como arreglo de tokens y resultó mejor producto:
  diez tareas despiezadas de golpe reproducen la avalancha de la que la persona venía huyendo.
- **Modelo elegido midiendo.** Cuatro modelos occidentales sobre los mismos cinco casos:
  Gemma 3 y gpt-oss-120b pasan; Nemotron 3.5 Lightning se trunca; Llama 3.3 70B no completa
  ni una vez en 60 s. La evidencia está en `evaluation-evidence/`.
- **Rúbrica determinística, no un segundo modelo de juez.** Es gratis, reproducible y cada
  aprobación se puede señalar con el dedo en `lib/verify.ts`.

## Interfaz: pantalla por pantalla, nunca de golpe

El diseño lo lidera **Antigravity** bajo la dirección macro del Founder (Ricardo). El ciclo
es: **propuesta visual en `diseno-ui/antigravity/` → el Founder decide y valida → se construye
esa pantalla en código → siguiente.** Nunca varias pantallas en una pasada: lo que sale así hay
que tirarlo.

El sistema de diseño maestro está documentado en `../diseno-ui/antigravity/SISTEMA_DISENO_DOMI.md`
y en `identidad-domi/direccion-visual-domi.md` ("La mesa libre", Territorio B). Sus reglas mandan:
tipografía obligatoria `Atkinson Hyperlegible Next`, fondo Cal `#F5F5EF`, base abierta 4:1 como
isotipo oficial, **una sola acción en barro (#D97745) por pantalla**, botones calibrados a 52-56px,
y cerrar vacía la mesa. Nada de inventar lenguaje visual nuevo, fuentes default ni gradientes genéricos de IA.


## Qué se trajo del producto privado, y por qué

Del Domi privado se reusan **patrones, no archivos**: el sistema de diseño (reescrito en CSS
plano, sin Tailwind), el arreglo del bug de permisos del dictado (arrancar el reconocimiento
dentro del toque, sin comprobación previa con `await`), y la metodología de evaluación. Todo
lo demás está escrito aquí desde cero.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
