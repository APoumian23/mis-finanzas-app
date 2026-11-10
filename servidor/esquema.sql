-- Mis Finanzas: usuarios, sesiones y los registros de la app (un renglón por registro de cada tabla).
-- Se puede correr varias veces: solo crea lo que falte.

CREATE TABLE IF NOT EXISTS usuarios (
  id        serial PRIMARY KEY,
  usuario   text NOT NULL UNIQUE,
  hash      text NOT NULL,
  creado    timestamptz NOT NULL DEFAULT now()
);

-- Solo se guarda la huella (sha256) del token: si alguien lee la base, no puede usar las sesiones
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash text PRIMARY KEY,
  usuario_id integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada     timestamptz NOT NULL DEFAULT now(),
  expira     timestamptz NOT NULL,
  ultimo_uso timestamptz NOT NULL DEFAULT now()
);

-- Cada cambio recibe un número de versión creciente: un dispositivo pide "lo que cambió después de la versión N"
CREATE SEQUENCE IF NOT EXISTS version_registros;

CREATE TABLE IF NOT EXISTS registros (
  usuario_id integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tabla      text    NOT NULL,
  id         text    NOT NULL,
  dato       jsonb,
  borrado    boolean NOT NULL DEFAULT false,
  ts         bigint  NOT NULL,   -- cuándo lo cambió el dispositivo (ms); gana el cambio más reciente
  version    bigint  NOT NULL,
  PRIMARY KEY (usuario_id, tabla, id)
);
CREATE INDEX IF NOT EXISTS registros_version ON registros (usuario_id, version);
