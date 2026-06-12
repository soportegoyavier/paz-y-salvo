-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Renombrar áreas con cargos institucionales
--  2026-06-12
-- ═══════════════════════════════════════════════════════════

-- Áreas DEPARTAMENTALES (jefes académicos)
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Artes'                    WHERE nombre = 'Artes'                  AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Ciencias Naturales'       WHERE nombre = 'Ciencias Naturales'     AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Ciencias Sociales'        WHERE nombre = 'Ciencias Sociales'      AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Educación Física'         WHERE nombre = 'Educación Física'       AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Inglés'                   WHERE nombre = 'Inglés'                 AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Lenguaje'                 WHERE nombre = 'Lenguaje'               AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Matemáticas'              WHERE nombre = 'Matemáticas'            AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Jefe(a) de Área de Tecnología e Informática' WHERE nombre = 'Tecnología e Informática' AND tipo = 'DEPARTAMENTAL';
UPDATE ps_areas SET nombre = 'Asistente de Marketing y Diseño'             WHERE nombre = 'Marketing y Diseño'     AND tipo = 'DEPARTAMENTAL';

-- Áreas GENERALES (estaciones de aprobación)
UPDATE ps_areas SET nombre = 'Asistente administrativo(a) y de servicios'  WHERE nombre = 'Restaurante';
UPDATE ps_areas SET nombre = 'Profesional en Talento Humano y SST'          WHERE nombre = 'Talento Humano';
UPDATE ps_areas SET nombre = 'Auxiliar administrativo(a) — Tecnología'      WHERE nombre = 'Responsable de Tecnología';
UPDATE ps_areas SET nombre = 'Auxiliar administrativo(a) — Biblioteca'      WHERE nombre = 'Responsable de Biblioteca';
UPDATE ps_areas SET nombre = 'Rector(a)'                                    WHERE nombre = 'Rectora';
UPDATE ps_areas SET nombre = 'Coordinador(a) de Convivencia General'        WHERE nombre = 'Coord. General de Convivencia';
UPDATE ps_areas SET nombre = 'Coordinador(a) de Académica General'          WHERE nombre = 'Coord. General Académica';
UPDATE ps_areas SET nombre = 'Coordinador(a) Administrativa'                WHERE nombre = 'Coord. Administrativa';
UPDATE ps_areas SET nombre = 'Coordinador(a) Preescolar'                    WHERE nombre = 'Coord. Preescolar';
UPDATE ps_areas SET nombre = 'Coordinador(a) Académica Primaria'            WHERE nombre = 'Coord. Académica Primaria';
