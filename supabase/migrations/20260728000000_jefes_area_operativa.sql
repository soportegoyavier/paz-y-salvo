-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Separar jefe de área operativa (Servicios
--  Generales vs Mantenimiento)
--  El área operativa (SERVICIOS) tenía un solo "jefe" implícito
--  (Johana Ortiz, vía la estación general "Asistente
--  administrativo(a) y de servicios"). En la práctica hay dos
--  jefes distintos: Servicios Generales (aseo/cocina, Johana
--  Ortiz Emilse) y Mantenimiento (Anderson David Cala Mora, que
--  también dirige Marketing y Diseño). Se agregan dos áreas
--  seleccionables (aplica_a vacío, como los jefes departamentales
--  de docentes) para que cada colaborador operativo elija su jefe
--  real desde el formulario de colaborador.
--  2026-07-28
-- ═══════════════════════════════════════════════════════════

INSERT INTO ps_areas (nombre, tipo, aplica_a, aplica_nivel, activo)
VALUES
  ('Jefe(a) de Servicios Generales', 'GENERAL', '', '', true),
  ('Jefe(a) de Mantenimiento',        'GENERAL', '', '', true)
ON CONFLICT (lower(nombre)) DO NOTHING;

-- Johana Ortiz Emilse sigue siendo jefa de Servicios Generales
UPDATE ps_usuarios u
SET area_ids = u.area_ids || a.id
FROM ps_areas a
WHERE a.nombre = 'Jefe(a) de Servicios Generales'
  AND u.username = 'johanao.gomez'
  AND NOT (a.id = ANY(u.area_ids));

-- Anderson Cala Mora ahora también dirige Mantenimiento (además de Marketing y Diseño)
UPDATE ps_usuarios u
SET area_ids = u.area_ids || a.id
FROM ps_areas a
WHERE a.nombre = 'Jefe(a) de Mantenimiento'
  AND u.username = 'andersonc.mora'
  AND NOT (a.id = ANY(u.area_ids));

-- Los operativos actuales no tenían jefe individual asignado: quedan
-- por defecto bajo Servicios Generales (refleja el estado real de hoy).
-- El SA reasigna manualmente a Mantenimiento los que correspondan.
UPDATE ps_colaboradores
SET areas_requeridas = (SELECT id FROM ps_areas WHERE nombre = 'Jefe(a) de Servicios Generales')
WHERE tipo_colaborador = 'SERVICIOS' AND areas_requeridas IS NULL;
