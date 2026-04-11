-- scripts/init-db.sql
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- Tabla principal de gastos
CREATE TABLE IF NOT EXISTS gastos (
  id                  BIGSERIAL PRIMARY KEY,
  telegram_user_id    BIGINT NOT NULL,
  telegram_chat_id    BIGINT NOT NULL,
  telegram_message_id BIGINT NOT NULL,
  monto               NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
  categoria           TEXT NOT NULL DEFAULT 'Otros',
  descripcion         TEXT,
  establecimiento     TEXT,
  raw_message         TEXT,
  
  -- Receipt photo fields
  receipt_photo_url   TEXT,                    -- Supabase Storage URL
  receipt_photo_file_id TEXT,                  -- Telegram file_id para re-descargar
  ocr_confidence      TEXT CHECK (ocr_confidence IN ('alta', 'media', 'baja')),
  extraction_method   TEXT NOT NULL DEFAULT 'texto' CHECK (extraction_method IN ('texto', 'ocr', 'manual')),
  fecha_recibo        TIMESTAMPTZ,             -- Fecha detectada en el recibo
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Clave única para idempotencia
  CONSTRAINT uq_user_message UNIQUE (telegram_user_id, telegram_message_id)
);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_gastos_user_date
  ON gastos (telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gastos_user_categoria
  ON gastos (telegram_user_id, categoria);

CREATE INDEX IF NOT EXISTS idx_gastos_user_extraction_method
  ON gastos (telegram_user_id, extraction_method);

CREATE INDEX IF NOT EXISTS idx_gastos_user_ocr_confidence
  ON gastos (telegram_user_id, ocr_confidence);

-- (Opcional) Función RPC para resumen agrupado nativo
-- Permite llamar: supabase.rpc('resumen_mensual', { p_user_id: 123, p_year: 2026, p_month: 4 })
CREATE OR REPLACE FUNCTION resumen_mensual(p_user_id BIGINT, p_year INT, p_month INT)
RETURNS TABLE (categoria TEXT, total NUMERIC, cantidad BIGINT) AS $$
BEGIN
  RETURN QUERY
    SELECT
      g.categoria,
      SUM(g.monto) AS total,
      COUNT(*)::BIGINT AS cantidad
    FROM gastos g
    WHERE g.telegram_user_id = p_user_id
      AND EXTRACT(YEAR FROM g.created_at) = p_year
      AND EXTRACT(MONTH FROM g.created_at) = p_month
    GROUP BY g.categoria
    ORDER BY total DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Habilitar Row Level Security (buena práctica)
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;

-- Policy: service_role puede todo (el bot usa service_role key)
CREATE POLICY "service_role_full_access" ON gastos
  FOR ALL
  USING (true)
  WITH CHECK (true);
