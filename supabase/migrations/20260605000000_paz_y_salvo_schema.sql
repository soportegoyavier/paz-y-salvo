-- ═══════════════════════════════════════════════════════════
--  PAZ Y SALVO — Schema completo v1
--  Proyecto: ihzgfcojethwxphbnlmg.supabase.co
-- ═══════════════════════════════════════════════════════════

-- ÁREAS
CREATE TABLE IF NOT EXISTS ps_areas (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       TEXT        NOT NULL,
  descripcion  TEXT        NOT NULL DEFAULT '',
  activo       BOOLEAN     NOT NULL DEFAULT TRUE,
  tipo         TEXT        NOT NULL DEFAULT 'GENERAL' CHECK (tipo IN ('GENERAL','DEPARTAMENTAL')),
  aplica_a     TEXT        NOT NULL DEFAULT '',
  aplica_nivel TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ps_areas_nombre_uq ON ps_areas (lower(nombre));

-- COLABORADORES
CREATE TABLE IF NOT EXISTS ps_colaboradores (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             TEXT        NOT NULL,
  cedula             TEXT        NOT NULL,
  activo             BOOLEAN     NOT NULL DEFAULT TRUE,
  requiere_paz_salvo BOOLEAN     NOT NULL DEFAULT TRUE,
  tipo_colaborador   TEXT        NOT NULL DEFAULT '',
  nivel_educativo    TEXT        NOT NULL DEFAULT '',
  areas_requeridas   UUID        REFERENCES ps_areas(id) ON DELETE SET NULL,
  area_trabajo       TEXT        NOT NULL DEFAULT '',
  fecha_creacion     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ps_colaboradores_cedula_uq ON ps_colaboradores (cedula);

-- USUARIOS
CREATE TABLE IF NOT EXISTS ps_usuarios (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username         TEXT        NOT NULL,
  password_hash    TEXT        NOT NULL DEFAULT '',
  legacy_hash      TEXT        NOT NULL DEFAULT '',
  rol              TEXT        NOT NULL CHECK (rol IN ('SUPERADMIN','ADMIN','COLABORADOR')),
  area_ids         UUID[]      NOT NULL DEFAULT '{}',
  email            TEXT        NOT NULL DEFAULT '',
  cedula           TEXT        NOT NULL DEFAULT '',
  activo           BOOLEAN     NOT NULL DEFAULT TRUE,
  cambiar_password BOOLEAN     NOT NULL DEFAULT FALSE,
  fecha_creacion   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ps_usuarios_username_uq  ON ps_usuarios (lower(username));
CREATE INDEX        IF NOT EXISTS ps_usuarios_area_ids_idx ON ps_usuarios USING GIN (area_ids);

-- APROBACIONES
CREATE TABLE IF NOT EXISTS ps_aprobaciones (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id UUID        NOT NULL REFERENCES ps_colaboradores(id) ON DELETE CASCADE,
  area_id        UUID        NOT NULL REFERENCES ps_areas(id) ON DELETE CASCADE,
  estado         TEXT        NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('APROBADO','RECHAZADO','PENDIENTE')),
  observaciones  TEXT        NOT NULL DEFAULT '',
  aprobado_por   TEXT        NOT NULL DEFAULT '',
  fecha_accion   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ps_aprobaciones_colab_area_uq UNIQUE (colaborador_id, area_id)
);
CREATE INDEX IF NOT EXISTS ps_aprobaciones_colab_idx ON ps_aprobaciones (colaborador_id);
CREATE INDEX IF NOT EXISTS ps_aprobaciones_area_idx  ON ps_aprobaciones (area_id);

-- CÓDIGOS DE VERIFICACIÓN
CREATE TABLE IF NOT EXISTS ps_codigos_verificacion (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         TEXT        NOT NULL,
  colaborador_id UUID        NOT NULL REFERENCES ps_colaboradores(id) ON DELETE CASCADE,
  fecha_emision  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activo         BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS ps_codigos_codigo_uq       ON ps_codigos_verificacion (upper(codigo));
CREATE INDEX        IF NOT EXISTS ps_codigos_colab_activo_idx ON ps_codigos_verificacion (colaborador_id, activo);

-- CONFIG
CREATE TABLE IF NOT EXISTS ps_config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);

-- LOGS
CREATE TABLE IF NOT EXISTS ps_logs (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario   TEXT        NOT NULL DEFAULT 'SISTEMA',
  rol       TEXT        NOT NULL DEFAULT '-',
  accion    TEXT        NOT NULL,
  detalle   TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ps_logs_timestamp_idx ON ps_logs (timestamp DESC);

-- SESIONES
CREATE TABLE IF NOT EXISTS ps_sesiones (
  token      TEXT        PRIMARY KEY,
  usuario_id UUID        NOT NULL REFERENCES ps_usuarios(id) ON DELETE CASCADE,
  username   TEXT        NOT NULL,
  rol        TEXT        NOT NULL,
  area_ids   UUID[]      NOT NULL DEFAULT '{}',
  expira     TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ps_sesiones_expira_idx ON ps_sesiones (expira);

-- ─── RLS ────────────────────────────────────────────────────
ALTER TABLE ps_areas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_colaboradores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_usuarios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_aprobaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_codigos_verificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ps_sesiones             ENABLE ROW LEVEL SECURITY;

-- Lectura pública (anon) solo en lo estrictamente necesario
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_areas' AND tablename = 'ps_areas') THEN
    CREATE POLICY "anon_read_areas" ON ps_areas FOR SELECT TO anon USING (activo = TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_colabs' AND tablename = 'ps_colaboradores') THEN
    CREATE POLICY "anon_read_colabs" ON ps_colaboradores FOR SELECT TO anon USING (activo = TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_codigos' AND tablename = 'ps_codigos_verificacion') THEN
    CREATE POLICY "anon_read_codigos" ON ps_codigos_verificacion FOR SELECT TO anon USING (activo = TRUE);
  END IF;
END $$;

-- ─── FUNCIÓN AUXILIAR ────────────────────────────────────────
CREATE OR REPLACE FUNCTION ps_get_areas_omitidas(p_cedula TEXT)
RETURNS UUID[] AS $$
  SELECT COALESCE(ARRAY_AGG(DISTINCT unnested_id ORDER BY unnested_id), '{}'::UUID[])
  FROM ps_usuarios u, LATERAL UNNEST(u.area_ids) AS unnested_id
  WHERE u.rol = 'ADMIN' AND u.activo = TRUE AND u.cedula = p_cedula AND p_cedula != '';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── CONFIG POR DEFECTO ──────────────────────────────────────
INSERT INTO ps_config (clave, valor) VALUES
  ('PROCESO_ACTIVO',      'TRUE'),
  ('INSTITUCION_NOMBRE',  'Colegio Campestre Goyavier'),
  ('VERSION',             '2.0'),
  ('EMAIL_TALENTO_HUMANO',''),
  ('SESSION_TTL_MINUTES', '480'),
  ('PASSWORD_SALT',       'GOYAVIER_SALT_2026_')
ON CONFLICT (clave) DO NOTHING;
