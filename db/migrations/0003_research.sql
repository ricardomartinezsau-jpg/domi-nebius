-- Investigación con fuentes. Existe porque un micro-paso que dice "manda el
-- newsletter" envejece: lo que cambia no es la tarea, es cómo se hace hoy.
--
-- La regla del producto y la del premio coinciden: guardar lo que se encontró,
-- decidir con eso qué falta por buscar, y marcar lo que no se pudo confirmar.
-- Una persona en parálisis ejecutiva va a ACTUAR sobre esto; un dato sin
-- respaldo hace daño real.

-- Cada pregunta que el sistema decidió investigar, y en qué vuelta la decidió.
-- vuelta 1 = hueco detectado en el plan; vuelta 2+ = lo que faltó tras leer
-- los hallazgos de la vuelta anterior.
CREATE TABLE IF NOT EXISTS research_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  round INT NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  -- Por qué se preguntó esto: qué micro-paso quedaba incompleto sin la respuesta.
  asked_because TEXT NOT NULL,
  -- Si quedó resuelta, sin resolver, o se descartó por no valer la búsqueda.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'unresolved', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_questions_run_idx ON research_questions (run_id, round);

-- Lo que se encontró, con su fuente. Sin fuente no entra: es la diferencia
-- entre informar y adivinar en voz alta.
CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES research_questions (id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_name TEXT,
  snippet TEXT,
  -- Qué tan respaldada quedó: varias fuentes coincidiendo, una sola, o
  -- contradicción entre ellas. Lo que no llegue a 'strong' se le muestra a la
  -- persona marcado como sin confirmar.
  confidence TEXT NOT NULL DEFAULT 'single'
    CHECK (confidence IN ('strong', 'single', 'conflicting')),
  published_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS findings_run_idx ON findings (run_id);
CREATE INDEX IF NOT EXISTS findings_question_idx ON findings (question_id);

-- Control de pasos del proceso en segundo plano.
--
-- Si un paso se reintenta (falla la red, se agota el tiempo), no puede volver a
-- crear las mismas tareas ni cobrar dos veces la misma búsqueda. La clave única
-- por (run, paso) es lo que hace que reintentar sea seguro: el segundo intento
-- encuentra el resultado del primero en vez de rehacerlo.
CREATE TABLE IF NOT EXISTS run_steps (
  run_id UUID NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'done', 'failed')),
  attempt INT NOT NULL DEFAULT 1,
  -- El resultado del paso, para que un reintento posterior lo reuse tal cual.
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, step)
);

-- Estado visible del proceso para quien está esperando del otro lado.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'
  CHECK (status IN ('queued', 'running', 'done', 'failed'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS current_step TEXT;
