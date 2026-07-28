-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Áreas adicionales requeridas por colaborador
--  `ps_colaboradores.areas_requeridas` solo admite un UUID (un área
--  departamental extra). Esta tabla permite requerir aprobación de
--  áreas adicionales sin reemplazar esa asignación existente.
--  Caso puntual: PINTO ORTEGA YEANMARA (DOCENTE) también requiere
--  aprobación de "Coordinador(a) Administrativa".
--  2026-07-27
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ps_colaborador_areas_extra (
  colaborador_id UUID NOT NULL REFERENCES ps_colaboradores(id) ON DELETE CASCADE,
  area_id        UUID NOT NULL REFERENCES ps_areas(id)         ON DELETE CASCADE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (colaborador_id, area_id)
);

ALTER TABLE ps_colaborador_areas_extra ENABLE ROW LEVEL SECURITY;

INSERT INTO ps_colaborador_areas_extra (colaborador_id, area_id)
VALUES ('1285cb54-b3aa-4e96-b67b-6fa76dc94986', '55f64165-32e6-4f95-bcdc-1b84fca3ad23')
ON CONFLICT DO NOTHING;
