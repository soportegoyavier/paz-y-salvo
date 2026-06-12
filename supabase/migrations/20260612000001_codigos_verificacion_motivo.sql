-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — motivo_inactivacion en codigos_verificacion
--  2026-06-12
-- ═══════════════════════════════════════════════════════════
--
-- Permite distinguir por qué un código dejó de estar vigente:
--   REVOCADO    → las aprobaciones del colaborador fueron eliminadas/rechazadas
--   REEMPLAZADO → se emitió un certificado más reciente
--
-- Si motivo_inactivacion IS NULL y activo = true → código vigente.
-- Si activo = false → consultar motivo_inactivacion para el mensaje adecuado.

ALTER TABLE ps_codigos_verificacion
  ADD COLUMN IF NOT EXISTS motivo_inactivacion TEXT;
