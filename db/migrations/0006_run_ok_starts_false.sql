-- Una ejecución nace sin haber salido bien.
--
-- `runs.ok` se declaró en 0002 con DEFAULT true. El efecto es que toda
-- ejecución afirma haber salido bien desde el instante en que se crea, antes
-- de que su primer paso corra. En la evidencia de la corrida del 12 de
-- septiembre de 2026 se ve exactamente eso: un segundo después de insertarse
-- la fila, con cero preguntas, cero hallazgos y cero pasos, la columna ya
-- decía que sí.
--
-- Esa columna es lo que responde «¿esto funcionó?». Tiene que empezar
-- diciendo que no y ganarse el sí en `finishRun`, que es la única puerta que
-- ahora declara terminada una investigación y sólo lo hace con hallazgos,
-- fuentes y una guía con al menos un paso delante.
--
-- No se toca el pasado que ya está resuelto: sólo se corrigen las ejecuciones
-- que siguen en vuelo y aun así afirman éxito.

ALTER TABLE runs ALTER COLUMN ok SET DEFAULT false;

UPDATE runs
   SET ok = false
 WHERE ok = true
   AND status IN ('queued', 'running');
