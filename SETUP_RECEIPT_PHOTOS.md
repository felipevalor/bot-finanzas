# 📷 Setup Receipt Photos - Guía Rápida

## 1️⃣ Ejecutar Migración de Base de Datos

**Opción A: Si es un proyecto nuevo** (tabla no existe)
```sql
-- Ejecutar scripts/init-db.sql completo
```

**Opción B: Si ya tienes la tabla `gastos`** (migración)
```sql
-- Ejecutar scripts/migracion_recibos.sql
-- Esto agrega las columnas nuevas sin borrar datos existentes
```

### Pasos:
1. Ve a tu proyecto en Supabase
2. Click en **SQL Editor** (barra lateral)
3. Click en **New Query**
4. Copiar y pegar el contenido de `scripts/migracion_recibos.sql`
5. Click en **Run** (Ctrl+Enter)
6. Deberías ver un mensaje de éxito ✅

---

## 2️⃣ Crear Storage Bucket para Recibos

### Desde el Dashboard de Supabase:

1. Ve a **Storage** (barra lateral izquierda)
2. Click en **New Bucket**
3. Configuración:
   - **Name**: `receipt-photos`
   - **Public**: ❌ **NO** (dejar privado)
   - **File size limit**: `4194304` bytes (4MB)
   - **Allowed MIME types**: 
     - `image/jpeg`
     - `image/png`
     - `image/webp`
4. Click en **Create bucket**

### Desde SQL (alternativa):

Si prefieres crear el bucket vía SQL, ejecuta esto en el SQL Editor:

```sql
-- Habilitar extensión de storage si no está habilitada
CREATE EXTENSION IF NOT EXISTS "storage" SCHEMA "storage";

-- Crear el bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipt-photos',
  'receipt-photos',
  false,
  4194304,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Políticas de seguridad (RLS)
CREATE POLICY "Users can upload their own receipts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'receipt-photos');

CREATE POLICY "Users can view their own receipts"
ON storage.objects FOR SELECT
USING (bucket_id = 'receipt-photos');

CREATE POLICY "Users can delete their own receipts"
ON storage.objects FOR DELETE
USING (bucket_id = 'receipt-photos');
```

---

## 3️⃣ Verificar que Todo Está Listo

### Verificar columnas en la tabla:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'gastos'
  AND column_name IN (
    'receipt_photo_url',
    'receipt_photo_file_id',
    'ocr_confidence',
    'extraction_method',
    'fecha_recibo'
  )
ORDER BY ordinal_position;
```

Deberías ver 5 filas con los tipos correctos.

### Verificar bucket:
```sql
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'receipt-photos';
```

Deberías ver 1 fila con la configuración del bucket.

---

## 4️⃣ Deploy a Render

Una vez que la migración está lista, solo queda hacer deploy:

```bash
git add .
git commit -m "feat: add receipt photo upload support"
git push origin main
```

Render hará deploy automático. El bot estará listo para recibir fotos de recibos.

---

## 5️⃣ Probar el Flujo Completo

1. Abrí Telegram y buscá tu bot
2. Enviá `/start` - deberías ver la opción de foto mencionada
3. Tomá una foto de un recibo y enviala al bot
4. El bot debería:
   - Mostrar "typing..." mientras procesa
   - Extraer los datos del recibo con OCR
   - Guardar el gasto con la foto
   - Enviar confirmación con los datos extraídos

---

## 🐛 Troubleshooting

### Error: "column receipt_photo_url does not exist"
- **Solución**: No ejecutaste la migración. Volvé al paso 1.

### Error: "Bucket not found"
- **Solución**: No creaste el bucket. Volvé al paso 2.

### Error: "Storage upload failed"
- **Causa posible**: Políticas RLS mal configuradas
- **Solución**: Verificar que las políticas del paso 2 estén creadas

### El bot no responde a las fotos
- **Verificación 1**: Revisar logs de Render para ver errores
- **Verificación 2**: Asegurarse de que el webhook incluya 'photo' en allowed_updates
- **Verificación 3**: Verificar que la imagen sea JPEG, PNG o WebP

### Groq Vision API error
- **Causa posible**: Rate limit o modelo no disponible
- **Solución**: Esperar 30s y reintentar. Si persiste, verificar [status de Groq](https://console.groq.com/)

---

## 📊 Monitoreo

### Ver storage usage en Supabase:
1. Ir a **Settings** > **Storage**
2. Ver el uso actual vs límite de 1GB (free tier)

### Ver gastos con receipts:
```sql
SELECT 
  id,
  monto,
  categoria,
  establecimiento,
  extraction_method,
  ocr_confidence,
  receipt_photo_url,
  created_at
FROM gastos
WHERE extraction_method = 'ocr'
ORDER BY created_at DESC
LIMIT 10;
```

---

## ✅ Checklist Final

- [ ] Migración de DB ejecutada
- [ ] Bucket `receipt-photos` creado
- [ ] Políticas RLS configuradas
- [ ] Columns verificadas en la tabla
- [ ] Bucket verificado en Storage
- [ ] Código pusheado a GitHub
- [ ] Deploy en Render completado
- [ ] `/start` actualizado funciona
- [ ] Prueba con foto de recibo exitosa

---

**¡Listo! Tu bot ahora puede recibir y procesar fotos de recibos** 🎉
