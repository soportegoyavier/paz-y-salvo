-- Corrección puntual de datos: paz y salvo FORZADO de HERMA JULIETH HERNANDEZ CALDERON (cédula 1077840060).
--
-- Problema: la acción forzar_paz_salvo aprobaba TODAS las áreas activas (22) a nombre del SUPERADMIN
-- que forzaba (jhohang.gomez). El certificado listaba las 9 áreas que sí le aplican, pero cada una
-- con el nombre del SUPERADMIN en vez del de su responsable, y quedaron 13 aprobaciones de áreas
-- que no le aplican (departamentales, Preescolar, Académica General, Mantenimiento, Servicios).
--
-- El código de la Edge Function ya se corrigió (solo áreas requeridas, a nombre del responsable de
-- cada una). Esta migración repara el dato ya guardado, sin tocar el código de verificación vigente.
--
-- Estado previo (para revertir si hiciera falta): 22 filas APROBADO, aprobado_por='jhohang.gomez',
-- fecha_accion='2026-10-01 16:26:15.062+00', observaciones=''.
--
-- Inocua si la cédula no existe (p. ej. staging): los UPDATE/DELETE afectan 0 filas.

WITH colab AS (
  SELECT id, upper(trim(tipo_colaborador)) AS tipo, upper(trim(nivel_educativo)) AS nivel
  FROM ps_colaboradores
  WHERE cedula = '1077840060'
), req AS (
  -- Mismas reglas que getAreasRequeridas() (ruta principal por aplica_a/aplica_nivel).
  SELECT c.id AS colaborador_id, a.id AS area_id,
    (SELECT u.username
       FROM ps_usuarios u
      WHERE u.activo AND u.rol IN ('ADMIN','SUPERADMIN') AND a.id = ANY (u.area_ids)
      ORDER BY (u.rol = 'ADMIN') DESC, lower(u.username)
      LIMIT 1) AS responsable
  FROM colab c
  JOIN ps_areas a ON a.activo
  WHERE (c.tipo = ANY (string_to_array(upper(replace(a.aplica_a, ' ', '')), ','))
         OR 'TODOS' = ANY (string_to_array(upper(replace(a.aplica_a, ' ', '')), ',')))
    AND (a.aplica_nivel = ''
         OR c.nivel = ANY (string_to_array(upper(replace(a.aplica_nivel, ' ', '')), ',')))
), actualiza AS (
  UPDATE ps_aprobaciones ap
     SET aprobado_por = req.responsable
    FROM req
   WHERE ap.colaborador_id = req.colaborador_id
     AND ap.area_id = req.area_id
     AND req.responsable IS NOT NULL
  RETURNING ap.area_id
)
DELETE FROM ps_aprobaciones ap
 USING colab c
 WHERE ap.colaborador_id = c.id
   AND ap.area_id NOT IN (SELECT area_id FROM req);
