#!/usr/bin/env node
/**
 * Seed / limpieza de datos QA en el proyecto de staging.
 * Uso:
 *   node tests/scripts/seed.js          → crea/actualiza datos de prueba
 *   node tests/scripts/seed.js --clean  → elimina todos los datos QA_*
 *
 * Requiere .env.test con STAGING_URL, STAGING_SERVICE_KEY y STAGING_ANON_KEY.
 */
import * as dotenv from 'dotenv';
import * as path   from 'path';
import * as fs     from 'fs';
import { createClient } from '@supabase/supabase-js';

// Funciona tanto desde tests/ como desde la raíz del proyecto
const envPath = path.resolve(process.cwd(), process.cwd().endsWith('tests') ? '.env.test' : 'tests/.env.test');
dotenv.config({ path: envPath });

const { STAGING_URL, STAGING_SERVICE_KEY } = process.env;
if (!STAGING_URL || !STAGING_SERVICE_KEY) {
  console.error('❌  Falta STAGING_URL o STAGING_SERVICE_KEY en tests/.env.test');
  process.exit(1);
}

const supabase = createClient(STAGING_URL, STAGING_SERVICE_KEY, {
  auth: { persistSession: false },
});

const CLEAN = process.argv.includes('--clean');
const PREFIX = 'QA0';      // cédulas de prueba empiezan con QA0

async function clean() {
  console.log('🧹  Limpiando datos QA...');

  // 1. Eliminar aprobaciones de colaboradores QA
  const { data: colabs } = await supabase
    .from('ps_colaboradores').select('id').ilike('cedula', 'QA%');
  if (colabs?.length) {
    const ids = colabs.map(c => c.id);
    await supabase.from('ps_aprobaciones').delete().in('colaborador_id', ids);
    await supabase.from('ps_codigos_verificacion').delete().in('colaborador_id', ids);
  }

  // 2. Eliminar colaboradores QA
  await supabase.from('ps_colaboradores').delete().ilike('cedula', 'QA%');

  // 3. Eliminar usuarios QA de ps_usuarios y de Supabase Auth
  const { data: users } = await supabase
    .from('ps_usuarios').select('id, auth_user_id, email').ilike('email', '%@goyavier.test');
  if (users?.length) {
    for (const u of users) {
      if (u.auth_user_id) {
        await supabase.auth.admin.deleteUser(u.auth_user_id);
      }
    }
    await supabase.from('ps_usuarios').delete().ilike('email', '%@goyavier.test');
  }

  // 4. Eliminar áreas QA
  await supabase.from('ps_areas').delete().ilike('nombre', 'QA %');

  console.log('✅  Datos QA eliminados.');
}

async function seed() {
  console.log('🌱  Creando datos QA en staging...');

  // ── 1. Áreas ──────────────────────────────────────────────────
  const seedSql = fs.readFileSync(
    path.resolve(process.cwd(), process.cwd().endsWith('tests') ? 'fixtures/seed.sql' : 'tests/fixtures/seed.sql'), 'utf8'
  );
  // Ejecutar SQL de áreas y colaboradores via RPC (requiere una función helper
  // o ejecutar los INSERTs con supabase-js)
  await seedAreas();
  await seedColaboradores();
  await seedUsuarios();
  console.log('✅  Seed completado. Credenciales de prueba en tests/fixtures/test-users.json');
}

async function seedAreas() {
  const areas = [
    // aplica_a:'TODOS' activa la rama de filtrado por aplica_a en getAreasRequeridas,
    // y las incluye para cualquier tipo de colaborador (DOCENTE, ADMINISTRATIVO, etc.)
    { id: 'a0000001-0000-0000-0000-000000000001', nombre: 'QA Secretaría Académica',   tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000002', nombre: 'QA Tecnología',             tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000003', nombre: 'QA Biblioteca',             tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000004', nombre: 'QA Restaurante',            tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000005', nombre: 'QA Coord. Administrativa',  tipo: 'GENERAL',       aplica_a: 'ADMINISTRATIVO', aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000006', nombre: 'QA Convivencia',            tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000007', nombre: 'QA Rectora',                tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000008', nombre: 'QA Talento Humano',         tipo: 'GENERAL',       aplica_a: 'TODOS',          aplica_nivel: '' },
    { id: 'a0000001-0000-0000-0000-000000000009', nombre: 'QA Jefe Área Matemáticas',  tipo: 'DEPARTAMENTAL', aplica_a: 'DOCENTE',        aplica_nivel: 'SECUNDARIA' },
  ].map(a => ({ ...a, descripcion: 'Área de prueba QA', activo: true }));

  const { error } = await supabase.from('ps_areas').upsert(areas, { onConflict: 'id' });
  if (error) { console.error('❌ seedAreas:', error.message); process.exit(1); }
  console.log('   ✓ Áreas QA OK');
}

async function seedColaboradores() {
  const colabs = [
    { id: 'c0000001-0000-0000-0000-000000000001', nombre: 'QA Docente Primaria',      cedula: 'QA0000001', tipo_colaborador: 'DOCENTE',             nivel_educativo: 'PRIMARIA',   area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000002', nombre: 'QA Administrativo',        cedula: 'QA0000002', tipo_colaborador: 'ADMINISTRATIVO',      nivel_educativo: '',           area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000003', nombre: 'QA Servicios Generales',   cedula: 'QA0000003', tipo_colaborador: 'SERVICIOS_GENERALES', nivel_educativo: '',           area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000004', nombre: 'QA Jefe Matemáticas',      cedula: 'QA0000004', tipo_colaborador: 'DOCENTE',             nivel_educativo: 'SECUNDARIA', area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000005', nombre: 'QA Resp Biblioteca',       cedula: 'QA0000005', tipo_colaborador: 'ADMINISTRATIVO',      nivel_educativo: '',           area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000006', nombre: 'QA Resp Tec y Biblio',     cedula: 'QA0000006', tipo_colaborador: 'ADMINISTRATIVO',      nivel_educativo: '',           area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000007', nombre: 'QA Talento Humano',        cedula: 'QA0000007', tipo_colaborador: 'ADMINISTRATIVO',      nivel_educativo: '',           area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000008', nombre: 'QA Coord Administrativa',  cedula: 'QA0000008', tipo_colaborador: 'ADMINISTRATIVO',      nivel_educativo: '',           area_trabajo: 'QA' },
    { id: 'c0000001-0000-0000-0000-000000000009', nombre: 'QA Docente Autoexclusion', cedula: 'QA0000009', tipo_colaborador: 'ADMINISTRATIVO',      nivel_educativo: '',           area_trabajo: 'QA' },
  ].map(c => ({ ...c, activo: true, requiere_paz_salvo: true }));

  const { error } = await supabase.from('ps_colaboradores').upsert(colabs, { onConflict: 'cedula' });
  if (error) { console.error('❌ seedColaboradores:', error.message); process.exit(1); }
  console.log('   ✓ Colaboradores QA OK');
}

async function seedUsuarios() {
  const defs = [
    { id: 'b0000001-0000-0000-0000-000000000001', username: 'qa_colab_docente',   email: 'qa_colab_docente@goyavier.test',   rol: 'COLABORADOR', cedula: 'QA0000001', area_ids: [] },
    { id: 'b0000001-0000-0000-0000-000000000002', username: 'qa_colab_admin',     email: 'qa_colab_admin@goyavier.test',     rol: 'COLABORADOR', cedula: 'QA0000002', area_ids: [] },
    { id: 'b0000001-0000-0000-0000-000000000003', username: 'qa_colab_servicios', email: 'qa_colab_servicios@goyavier.test', rol: 'COLABORADOR', cedula: 'QA0000003', area_ids: [] },
    { id: 'b0000001-0000-0000-0000-000000000004', username: 'qa_jefe_matematicas',email: 'qa_jefe_matematicas@goyavier.test',rol: 'ADMIN',       cedula: 'QA0000004', area_ids: ['a0000001-0000-0000-0000-000000000009'] },
    { id: 'b0000001-0000-0000-0000-000000000005', username: 'qa_resp_biblioteca', email: 'qa_resp_biblioteca@goyavier.test', rol: 'ADMIN',       cedula: 'QA0000005', area_ids: ['a0000001-0000-0000-0000-000000000003'] },
    { id: 'b0000001-0000-0000-0000-000000000006', username: 'qa_resp_tec_bib',    email: 'qa_resp_tec_bib@goyavier.test',    rol: 'ADMIN',       cedula: 'QA0000006', area_ids: ['a0000001-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000003'] },
    { id: 'b0000001-0000-0000-0000-000000000007', username: 'qa_talento_humano',  email: 'qa_talento_humano@goyavier.test',  rol: 'ADMIN',       cedula: 'QA0000007', area_ids: ['a0000001-0000-0000-0000-000000000008'] },
    { id: 'b0000001-0000-0000-0000-000000000008', username: 'qa_coord_admin',     email: 'qa_coord_admin@goyavier.test',     rol: 'ADMIN',       cedula: 'QA0000008', area_ids: ['a0000001-0000-0000-0000-000000000005'] },
    { id: 'b0000001-0000-0000-0000-000000000009', username: 'qa_superadmin',      email: 'qa_superadmin@goyavier.test',      rol: 'SUPERADMIN',  cedula: 'QA9999999', area_ids: [] },
    { id: 'b0000001-0000-0000-0000-000000000010', username: 'qa_colab_autoexcl',  email: 'qa_colab_autoexcl@goyavier.test',  rol: 'ADMIN',       cedula: 'QA0000009', area_ids: ['a0000001-0000-0000-0000-000000000003'] },
  ];

  const PASSWORD = 'QA_Test_2026!';

  for (const def of defs) {
    // Crear / recuperar cuenta en Supabase Auth
    let authUserId;
    const { data: existing } = await supabase.auth.admin.listUsers();
    const found = existing?.users?.find(u => u.email === def.email);

    if (found) {
      authUserId = found.id;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email:          def.email,
        password:       PASSWORD,
        email_confirm:  true,
      });
      if (error) { console.error(`❌ Auth createUser ${def.email}:`, error.message); continue; }
      authUserId = data.user.id;
    }

    // Upsert en ps_usuarios
    const { error } = await supabase.from('ps_usuarios').upsert({
      id:               def.id,
      username:         def.username,
      password_hash:    '',
      rol:              def.rol,
      area_ids:         def.area_ids,
      email:            def.email,
      cedula:           def.cedula,
      activo:           true,
      auth_user_id:     authUserId,
      cambiar_password: false,
    }, { onConflict: 'id' });

    if (error) console.error(`❌ ps_usuarios upsert ${def.username}:`, error.message);
    else       console.log(`   ✓ ${def.username} (${def.rol})`);
  }
}

// ── Entrypoint ─────────────────────────────────────────────────
if (CLEAN) {
  await clean();
} else {
  await seed();
}
