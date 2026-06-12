-- ═══════════════════════════════════════════════════════════════
--  SEED IDEMPOTENTE — Paz y Salvo QA Staging
--  Prefijo QA_TEST_ para distinguir datos de prueba.
--  Ejecutar con: node tests/scripts/seed.js
--  Todos los INSERT usan ON CONFLICT DO UPDATE o DO NOTHING.
-- ═══════════════════════════════════════════════════════════════

-- ─── ÁREAS DE PRUEBA ────────────────────────────────────────────
INSERT INTO ps_areas (id, nombre, descripcion, activo, tipo, aplica_a, aplica_nivel) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'QA Secretaría Académica',    'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000002', 'QA Tecnología',              'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000003', 'QA Biblioteca',              'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000004', 'QA Restaurante',             'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000005', 'QA Coord. Administrativa',   'QA test area', TRUE, 'GENERAL',       'ADMINISTRATIVO', ''),
  ('a0000001-0000-0000-0000-000000000006', 'QA Convivencia',             'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000007', 'QA Rectora',                 'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000008', 'QA Talento Humano',          'QA test area', TRUE, 'GENERAL',       '',        ''),
  ('a0000001-0000-0000-0000-000000000009', 'QA Jefe Área Matemáticas',   'QA test area', TRUE, 'DEPARTAMENTAL', 'DOCENTE', 'SECUNDARIA')
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE;

-- ─── COLABORADORES DE PRUEBA ────────────────────────────────────
INSERT INTO ps_colaboradores
  (id, nombre, cedula, activo, requiere_paz_salvo, tipo_colaborador, nivel_educativo, area_trabajo)
VALUES
  ('c0000001-0000-0000-0000-000000000001', 'QA Docente Primaria',        'QA0000001', TRUE, TRUE, 'DOCENTE',             'PRIMARIA',   'QA'),
  ('c0000001-0000-0000-0000-000000000002', 'QA Administrativo',          'QA0000002', TRUE, TRUE, 'ADMINISTRATIVO',      '',           'QA'),
  ('c0000001-0000-0000-0000-000000000003', 'QA Servicios Generales',     'QA0000003', TRUE, TRUE, 'SERVICIOS_GENERALES', '',           'QA'),
  ('c0000001-0000-0000-0000-000000000004', 'QA Jefe Matemáticas',        'QA0000004', TRUE, TRUE, 'DOCENTE',             'SECUNDARIA', 'QA'),
  ('c0000001-0000-0000-0000-000000000005', 'QA Resp. Biblioteca',        'QA0000005', TRUE, TRUE, 'ADMINISTRATIVO',      '',           'QA'),
  ('c0000001-0000-0000-0000-000000000006', 'QA Resp. Tec+Biblio',        'QA0000006', TRUE, TRUE, 'ADMINISTRATIVO',      '',           'QA'),
  ('c0000001-0000-0000-0000-000000000007', 'QA Talento Humano',          'QA0000007', TRUE, TRUE, 'ADMINISTRATIVO',      '',           'QA'),
  ('c0000001-0000-0000-0000-000000000008', 'QA Coord. Administrativa',   'QA0000008', TRUE, TRUE, 'ADMINISTRATIVO',      '',           'QA'),
  ('c0000001-0000-0000-0000-000000000009', 'QA Docente con Autoexcl.',   'QA0000009', TRUE, TRUE, 'ADMINISTRATIVO',      '',           'QA')
ON CONFLICT (cedula) DO UPDATE
  SET nombre = EXCLUDED.nombre, activo = TRUE, tipo_colaborador = EXCLUDED.tipo_colaborador;

-- ─── USUARIOS DE PRUEBA ─────────────────────────────────────────
-- NOTA: auth_user_id se rellena por el script seed.js tras crear cuentas en Supabase Auth.
-- area_ids apunta a los UUIDs fijos de las áreas QA de arriba.
INSERT INTO ps_usuarios
  (id, username, password_hash, rol, area_ids, email, cedula, activo)
VALUES
  ('u0000001-0000-0000-0000-000000000001', 'qa_colab_docente',   '', 'COLABORADOR', '{}',
   'qa_colab_docente@goyavier.test',   'QA0000001', TRUE),
  ('u0000001-0000-0000-0000-000000000002', 'qa_colab_admin',     '', 'COLABORADOR', '{}',
   'qa_colab_admin@goyavier.test',     'QA0000002', TRUE),
  ('u0000001-0000-0000-0000-000000000003', 'qa_colab_servicios', '', 'COLABORADOR', '{}',
   'qa_colab_servicios@goyavier.test', 'QA0000003', TRUE),
  ('u0000001-0000-0000-0000-000000000004', 'qa_jefe_matematicas','', 'ADMIN',
   ARRAY['a0000001-0000-0000-0000-000000000009']::uuid[],
   'qa_jefe_matematicas@goyavier.test','QA0000004', TRUE),
  ('u0000001-0000-0000-0000-000000000005', 'qa_resp_biblioteca', '', 'ADMIN',
   ARRAY['a0000001-0000-0000-0000-000000000003']::uuid[],
   'qa_resp_biblioteca@goyavier.test', 'QA0000005', TRUE),
  ('u0000001-0000-0000-0000-000000000006', 'qa_resp_tec_bib',    '', 'ADMIN',
   ARRAY['a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003']::uuid[],
   'qa_resp_tec_bib@goyavier.test',    'QA0000006', TRUE),
  ('u0000001-0000-0000-0000-000000000007', 'qa_talento_humano',  '', 'ADMIN',
   ARRAY['a0000001-0000-0000-0000-000000000008']::uuid[],
   'qa_talento_humano@goyavier.test',  'QA0000007', TRUE),
  ('u0000001-0000-0000-0000-000000000008', 'qa_coord_admin',     '', 'ADMIN',
   ARRAY['a0000001-0000-0000-0000-000000000005']::uuid[],
   'qa_coord_admin@goyavier.test',     'QA0000008', TRUE),
  ('u0000001-0000-0000-0000-000000000009', 'qa_superadmin',      '', 'SUPERADMIN', '{}',
   'qa_superadmin@goyavier.test',      'QA9999999', TRUE),
  -- Colaborador que también es responsable de Biblioteca (para test de autoexclusión)
  ('u0000001-0000-0000-0000-000000000010', 'qa_colab_autoexcl',  '', 'ADMIN',
   ARRAY['a0000001-0000-0000-0000-000000000003']::uuid[],
   'qa_colab_autoexcl@goyavier.test',  'QA0000009', TRUE)
ON CONFLICT (id) DO UPDATE
  SET rol = EXCLUDED.rol, area_ids = EXCLUDED.area_ids, activo = TRUE;
