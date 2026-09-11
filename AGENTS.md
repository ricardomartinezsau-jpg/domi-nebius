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
   sobre uno más que después nadie audita. Este repo no arrastra autenticación, base de
   datos ni i18n porque el producto no los necesita para cumplir su propósito — no porque
   falte tiempo.
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
- Cambiar de modelo, proveedor o endpoint de inferencia (hoy: exclusivamente Nebius Token
  Factory + `meta-llama/Llama-3.3-70B-Instruct`; no hay fallback a otro proveedor a
  propósito, para que la integración con el sponsor sea inequívoca).
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

## Qué NO traer de vuelta del producto privado (Domi)

Better Auth / login, Postgres + Drizzle + migraciones, i18n, dictado por voz, el sistema de
diseño completo. Ninguno de esos es necesario para que un desconocido entre, escriba un
vaciado mental y reciba un resultado usable — que es el criterio de "Shipping" del jurado.
Si alguno de estos vuelve a aparecer, que sea porque una necesidad real de este repo lo
justifica, no porque "ya existía en Domi".
