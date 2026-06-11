-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Fix tipo_colaborador coordinadores
--  2026-06-10
-- ═══════════════════════════════════════════════════════════
--
-- Problema: 5 colaboradores tenían tipo_colaborador vacío.
-- getAreasRequeridas() retorna [] cuando el tipo está en blanco,
-- por lo que el sistema no les exigía ningún área.
--
-- Fix:
--  - Coordinadores académicos/convivencia → DOCENTE
--  - Coord. Administrativa               → ADMINISTRATIVO
--  - Rectora                             → requiere_paz_salvo = false
--    (solo otorga paz y salvo, no lo necesita)

UPDATE ps_colaboradores
SET tipo_colaborador = 'DOCENTE',
    nivel_educativo  = CASE
      WHEN cedula = '37722360' THEN 'BACHILLERATO'
      ELSE nivel_educativo
    END
WHERE cedula IN (
  '37722360',   -- OTERO RODRIGUEZ SANDRA ROCIO      (Coord. General Academica)
  '63536066',   -- SANDOVAL LARROTTA SANDRA MILENA   (Coord. Academica Primaria)
  '1098663250'  -- VARGAS HERNANDEZ JULIAN FERNANDO  (Coord. General de Convivencia)
)
AND tipo_colaborador = '';

UPDATE ps_colaboradores
SET tipo_colaborador = 'ADMINISTRATIVO'
WHERE cedula = '63307820'
AND tipo_colaborador = '';

UPDATE ps_colaboradores
SET requiere_paz_salvo = false
WHERE cedula = '63275284';
