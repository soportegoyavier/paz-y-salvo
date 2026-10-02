-- DT-062 S4: réplica diaria de colaboradores Zaiko -> Paz y Salvo.
-- Zaiko es la fuente única de identidad (cédula, nombre, estado). Esta sincronización:
--   - crea en ps_colaboradores a quien está activo en Zaiko y no existe aquí (ALTA);
--   - actualiza el nombre si cambió en Zaiko (ACTUALIZAR);
--   - NUNCA inactiva: quien se retira sigue necesitando hacer su paz y salvo aquí, así que
--     "activo" en ps_colaboradores lo sigue manejando Paz y Salvo a mano (ver DT-062);
--   - NUNCA toca tipo_colaborador, nivel_educativo, areas_requeridas ni requiere_paz_salvo:
--     son del dominio propio de Paz y Salvo, Zaiko no los conoce.
--   - el correo vive en ps_usuarios (cuenta de Supabase Auth), fuera de alcance de este sync.
-- Arranca en modo INFORME: solo anota lo que haría.

create table if not exists ps_zaiko_sync (
  id             int primary key default 1,
  modo           text not null default 'INFORME' check (modo in ('INFORME', 'ESCRITURA', 'PAUSADO')),
  ultimo_corte   timestamptz,
  actualizado_en timestamptz not null default now(),
  constraint ps_zaiko_sync_singleton check (id = 1)
);
insert into ps_zaiko_sync (id, modo) values (1, 'INFORME') on conflict (id) do nothing;

create table if not exists ps_zaiko_sync_informe (
  id            bigint generated always as identity primary key,
  ejecutado_en  timestamptz not null default now(),
  accion        text not null, -- ALTA | ACTUALIZAR | INACTIVO_EN_ZAIKO (informativo, nunca se actúa)
  cedula        text not null,
  nombre_zaiko  text,
  nombre_ps     text,
  detalle       text
);
create index if not exists ps_zaiko_sync_informe_ejecutado_idx on ps_zaiko_sync_informe (ejecutado_en desc);

-- Mismo patrón que el resto de ps_*: RLS activa sin políticas, solo service_role (la Edge Function) escribe.
alter table ps_zaiko_sync enable row level security;
alter table ps_zaiko_sync_informe enable row level security;
revoke all on ps_zaiko_sync, ps_zaiko_sync_informe from anon, authenticated;
grant all on ps_zaiko_sync, ps_zaiko_sync_informe to service_role;
grant usage, select on sequence ps_zaiko_sync_informe_id_seq to service_role;
