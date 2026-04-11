-- Migración: tabla productos para histórico de precios por ítem
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS productos (
  id                   BIGSERIAL PRIMARY KEY,
  gasto_id             BIGINT NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
  telegram_user_id     BIGINT NOT NULL,
  nombre               TEXT NOT NULL,
  nombre_normalizado   TEXT NOT NULL,
  precio               NUMERIC(12,2) NOT NULL CHECK (precio > 0),
  cantidad             NUMERIC(10,3) DEFAULT 1,
  unidad               TEXT,
  establecimiento      TEXT,
  fecha                TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productos_user_nombre
  ON productos (telegram_user_id, nombre_normalizado);

CREATE INDEX IF NOT EXISTS idx_productos_user_fecha
  ON productos (telegram_user_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_productos_gasto
  ON productos (gasto_id);
