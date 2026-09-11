-- Memoria de la persona. Todo lo que cuelga de aquí existe por una razón:
-- que el segundo vaciado mental no se parezca al primero.

CREATE EXTENSION IF NOT EXISTS vector;

-- Calibración inicial: lo que la persona nos dice de sí misma al entrar.
-- Sin esto, el sistema le habla igual a alguien que quiere herramientas nuevas
-- que a alguien que prefiere hacerlo todo a mano.
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'es',
  -- Qué tanto quiere que le propongamos herramientas actuales en lugar de
  -- procesos manuales. Es la preferencia que gobierna el anclaje externo.
  tool_openness TEXT NOT NULL DEFAULT 'balanced'
    CHECK (tool_openness IN ('manual', 'balanced', 'ai_forward')),
  -- Bandeja que hoy le pesa más; orienta, no obliga.
  priority_tray TEXT
    CHECK (priority_tray IN ('personalBienestar', 'profesionalProductiva', 'familiarDomestica', 'socialComunitaria')),
  -- Trampas que la persona ya se reconoce a sí misma.
  known_cave_activities TEXT[] NOT NULL DEFAULT '{}',
  -- Herramientas que ya usa: no tiene sentido recomendarle lo que ya tiene.
  current_tools TEXT[] NOT NULL DEFAULT '{}',
  -- Cuántos minutos de arranque son realistas para ella, no para el promedio.
  activation_minutes INT NOT NULL DEFAULT 5 CHECK (activation_minutes BETWEEN 2 AND 15),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada vaciado guardado. Solo de personas con cuenta: el modo sin cuenta
-- procesa en memoria y no escribe una línea aquí.
CREATE TABLE IF NOT EXISTS dumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'es',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dumps_user_recent_idx ON dumps (user_id, created_at DESC);

-- Las tareas son la memoria real: lo que se hizo, lo que se abandonó, y
-- cuántas veces algo volvió a aparecer sin arrancar nunca.
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  dump_id UUID REFERENCES dumps (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  tray TEXT NOT NULL
    CHECK (tray IN ('personalBienestar', 'profesionalProductiva', 'familiarDomestica', 'socialComunitaria')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'abandoned')),
  micro_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Cuántos vaciados distintos volvieron a mencionar esto. Un número alto es
  -- la señal más honesta de que algo se está evitando.
  times_resurfaced INT NOT NULL DEFAULT 0,
  -- Huella numérica para buscar por parecido y no por palabra exacta.
  -- 1024 dimensiones: pedidas explícitamente al modelo de Nebius para que el
  -- índice siga siendo posible (pgvector indexa hasta 2000).
  embedding vector(1024),
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS tasks_embedding_idx ON tasks USING hnsw (embedding vector_cosine_ops);

-- Auditoría de cada ejecución del flujo: qué pasos corrió, qué recuperó de la
-- memoria, qué buscó afuera, cuánto costó y cuánto tardó. Es a la vez la
-- evidencia de la evaluación y la única forma de explicar una respuesta
-- después de haberla dado.
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  dump_id UUID REFERENCES dumps (id) ON DELETE CASCADE,
  -- En modo sin cuenta se guarda la medición, nunca el contenido.
  anonymous BOOLEAN NOT NULL DEFAULT false,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieved_task_ids UUID[] NOT NULL DEFAULT '{}',
  grounding JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL,
  prompt_tokens INT,
  completion_tokens INT,
  cost_usd NUMERIC(12, 8),
  latency_ms INT,
  ok BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_created_idx ON runs (created_at DESC);
