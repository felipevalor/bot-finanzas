-- migracion_recibos.sql
-- Ejecutar en Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Esta migración agrega columnas para almacenar fotos de recibos

-- ─── Agregar columnas para receipt photos ───────────────────────────────────

ALTER TABLE gastos 
ADD COLUMN IF NOT EXISTS receipt_photo_url TEXT,
ADD COLUMN IF NOT EXISTS receipt_photo_file_id TEXT,
ADD COLUMN IF NOT EXISTS ocr_confidence TEXT CHECK (ocr_confidence IN ('alta', 'media', 'baja')),
ADD COLUMN IF NOT EXISTS extraction_method TEXT NOT NULL DEFAULT 'texto' CHECK (extraction_method IN ('texto', 'ocr', 'manual')),
ADD COLUMN IF NOT EXISTS fecha_recibo TIMESTAMPTZ;

-- ─── Índices para queries con receipts ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gastos_user_extraction_method
  ON gastos (telegram_user_id, extraction_method);

CREATE INDEX IF NOT EXISTS idx_gastos_user_ocr_confidence
  ON gastos (telegram_user_id, ocr_confidence);

-- ─── Comentarios para documentación ────────────────────────────────────────

COMMENT ON COLUMN gastos.receipt_photo_url IS 'URL de la foto del recibo en Supabase Storage';
COMMENT ON COLUMN gastos.receipt_photo_file_id IS 'Telegram file_id para re-descargar la foto';
COMMENT ON COLUMN gastos.ocr_confidence IS 'Nivel de confianza del OCR: alta, media, baja';
COMMENT ON COLUMN gastos.extraction_method IS 'Método de extracción: texto, ocr, manual';
COMMENT ON COLUMN gastos.fecha_recibo IS 'Fecha detectada en el recibo (puede diferir de created_at)';

-- ─── Verificación ──────────────────────────────────────────────────────────

-- Verificar que las columnas se agregaron correctamente
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'gastos'
  AND column_name IN ('receipt_photo_url', 'receipt_photo_file_id', 'ocr_confidence', 'extraction_method', 'fecha_recibo')
ORDER BY ordinal_position;
