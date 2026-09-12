-- Cerrojo de último recurso contra ejecutores simultáneos.
--
-- La protección por (run_id, step) impide que un paso se rehaga, pero no impedía
-- que dos procesos lo reclamaran a la vez mientras estaba 'running': el de
-- Render Workflows y el de reserva local pueden acabar corriendo juntos si el
-- disparo parece fallar y en realidad no falló.
--
-- La defensa en el código es un permiso con caducidad. Esta es la de abajo, la
-- que no depende de que el código esté bien escrito: una ejecución no puede
-- tener dos veces la misma vuelta de investigación. Si dos ejecutores llegan a
-- la vez, el segundo choca contra la base y reusa lo que escribió el primero,
-- en vez de pagar otra búsqueda y duplicar los hallazgos.
CREATE UNIQUE INDEX IF NOT EXISTS research_questions_run_round_key
  ON research_questions (run_id, round);
