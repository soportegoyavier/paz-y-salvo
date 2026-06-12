/**
 * Llamadas directas a la Edge Function ps-api para setup/verificación en tests.
 * Usa el service role key de staging (NO anon key) para bypass de RLS cuando sea necesario.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Re-export para specs que importen CREDENTIALS desde api (debería ser auth, pero por compatibilidad)
export { CREDENTIALS } from './auth';

const { STAGING_URL, STAGING_SERVICE_KEY, STAGING_ANON_KEY } = process.env;

let _admin: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(STAGING_URL!, STAGING_SERVICE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

export function anonClient(): SupabaseClient {
  if (!_anon) {
    _anon = createClient(STAGING_URL!, STAGING_ANON_KEY!, {
      auth: { persistSession: false },
    });
  }
  return _anon;
}

/** Llama directamente a la Edge Function con un JWT generado para el usuario dado. */
export async function callApi(
  accion: string,
  body: Record<string, unknown>,
  email: string,
  password: string
): Promise<{ ok: boolean; [k: string]: unknown }> {
  const { data: session, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !session?.session) throw new Error(`callApi login failed: ${error?.message}`);

  const res = await fetch(`${STAGING_URL}/functions/v1/ps-api`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify({ action: accion, ...body }),
  });
  await anonClient().auth.signOut();
  return res.json();
}

/** Limpia aprobaciones de prueba de un colaborador específico. */
export async function limpiarAprobaciones(colaboradorId: string): Promise<void> {
  await adminClient()
    .from('ps_aprobaciones')
    .delete()
    .eq('colaborador_id', colaboradorId);
}

/** Obtiene todas las aprobaciones de un colaborador. */
export async function getAprobaciones(colaboradorId: string) {
  const { data } = await adminClient()
    .from('ps_aprobaciones')
    .select('*, ps_areas(nombre)')
    .eq('colaborador_id', colaboradorId);
  return data ?? [];
}

/** Verifica que una política RLS bloquee la operación. Devuelve true si fue bloqueada (error). */
export async function rlsBloqueado(fn: () => Promise<{ error: unknown }>): Promise<boolean> {
  const { error } = await fn();
  return !!error;
}

// IDs fijos de los colaboradores QA (coinciden con seed.sql)
export const QA_IDS = {
  COLAB_DOCENTE:     'c0000001-0000-0000-0000-000000000001',
  COLAB_ADMIN:       'c0000001-0000-0000-0000-000000000002',
  COLAB_SERVICIOS:   'c0000001-0000-0000-0000-000000000003',
  JEFE_MATEMATICAS:  'c0000001-0000-0000-0000-000000000004',
  RESP_BIBLIOTECA:   'c0000001-0000-0000-0000-000000000005',
  RESP_TEC_BIB:      'c0000001-0000-0000-0000-000000000006',
  TALENTO_HUMANO:    'c0000001-0000-0000-0000-000000000007',
  COORD_ADMIN:       'c0000001-0000-0000-0000-000000000008',
  COLAB_AUTOEXCL:    'c0000001-0000-0000-0000-000000000009',
  AREA_TECNOLOGIA:   'a0000001-0000-0000-0000-000000000002',
  AREA_BIBLIOTECA:   'a0000001-0000-0000-0000-000000000003',
  AREA_COORD_ADMIN:  'a0000001-0000-0000-0000-000000000005',
  AREA_TALENTO_HUM:  'a0000001-0000-0000-0000-000000000008',
  AREA_MATEMATICAS:  'a0000001-0000-0000-0000-000000000009',
};
