-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Coordinador(a) Administrativa pasa a ser obligatoria
--  para TODOS los tipos de colaborador (igual que "Profesional en
--  Talento Humano y SST"), no solo para ADMINISTRATIVO.
--  2026-07-28
-- ═══════════════════════════════════════════════════════════

UPDATE ps_areas
SET aplica_a = 'DOCENTE,ADMINISTRATIVO,SERVICIOS'
WHERE nombre = 'Coordinador(a) Administrativa';
