-- Identificador de ejecución en Render Workflows.
-- Vincula la auditoría interna de la base de datos con el estado de tareas en Render.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS task_run_id TEXT;
