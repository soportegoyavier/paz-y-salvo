-- ═══════════════════════════════════════════════════════
--  Índices de rendimiento, vista global y trigger audit
-- ═══════════════════════════════════════════════════════

-- C1 — Índices faltantes
CREATE INDEX IF NOT EXISTS ps_colaboradores_activo_idx   ON ps_colaboradores (activo);
CREATE INDEX IF NOT EXISTS ps_usuarios_email_idx         ON ps_usuarios (lower(email));
CREATE INDEX IF NOT EXISTS ps_usuarios_activo_rol_idx    ON ps_usuarios (activo, rol);
CREATE INDEX IF NOT EXISTS ps_aprobaciones_estado_idx    ON ps_aprobaciones (estado);
CREATE INDEX IF NOT EXISTS ps_codigos_activo_idx         ON ps_codigos_verificacion (activo);

-- C2 — Vista de estado de colaboradores (facilita reportes en panel SA)
CREATE OR REPLACE VIEW v_estado_colaboradores AS
SELECT
  c.id,
  c.nombre,
  c.cedula,
  c.activo,
  c.tipo_colaborador,
  c.requiere_paz_salvo,
  COUNT(a.id) FILTER (WHERE a.estado = 'APROBADO')  AS aprobadas,
  COUNT(a.id) FILTER (WHERE a.estado = 'PENDIENTE') AS pendientes,
  COUNT(a.id) FILTER (WHERE a.estado = 'RECHAZADO') AS rechazadas,
  COUNT(a.id)                                        AS total_aprobaciones
FROM ps_colaboradores c
LEFT JOIN ps_aprobaciones a ON a.colaborador_id = c.id
GROUP BY c.id;

-- C3 — Trigger de auditoría en ps_aprobaciones
CREATE OR REPLACE FUNCTION ps_audit_aprobaciones()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO ps_logs (accion, detalle, usuario, rol)
  VALUES (
    TG_OP || '_APROBACION',
    format('colaborador=%s area=%s estado=%s', NEW.colaborador_id, NEW.area_id, NEW.estado),
    COALESCE(NEW.aprobado_por, current_user),
    'TRIGGER'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_aprobaciones ON ps_aprobaciones;
CREATE TRIGGER audit_aprobaciones
  AFTER INSERT OR UPDATE ON ps_aprobaciones
  FOR EACH ROW EXECUTE FUNCTION ps_audit_aprobaciones();
