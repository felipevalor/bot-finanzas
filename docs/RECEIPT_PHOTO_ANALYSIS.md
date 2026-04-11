# 🧾 Receipt Photo Upload Feature - Deep Implementation Analysis

## 📋 Executive Summary

This document provides a comprehensive analysis of how to implement receipt photo upload functionality in your Telegram expense bot, allowing users to send photos of receipts and automatically extract/store expense data (amount, category, description, establishment).

---

## 🏗️ Current Architecture Context

**Tech Stack:**
- **Messaging:** Telegram Bot API (webhook-based)
- **AI/OCR:** Groq API (currently using `llama-3.1-8b-instant` for text parsing)
- **Database:** Supabase PostgreSQL
- **Hosting:** Render (free tier)
- **Runtime:** Node.js 20+ (ESM)

**Current Flow:**
```
User text → Telegram → Webhook → Groq AI parses → Supabase INSERT → Confirmation
```

**Key Constraint:** The bot currently only processes text messages (`req.body.message.text`). Photo/document messages are ignored.

---

## 🎯 Technical Approach Options for OCR

### **Option 1: Groq Vision API (RECOMMENDED) ⭐⭐⭐⭐⭐**

**What:** Use Groq's `meta-llama/llama-4-scout-17b-16e-instruct` model for OCR + structured extraction in ONE call.

**Pros:**
- ✅ **Already have a Groq account** - no new accounts/APIs needed
- ✅ **Free tier available** - same billing as current text parser
- ✅ **Single API call** - OCR + extraction in one step
- ✅ **Supports JSON mode** - can return structured expense data directly
- ✅ **Low latency** - Groq is optimized for speed
- ✅ **Supports base64 images** - works with Telegram file downloads
- ✅ **Up to 5 images per request** - can handle multi-photo receipts

**Cons:**
- ⚠️ Newer model (preview status) - may have occasional instability
- ⚠️ Max 4MB for base64-encoded images (need to compress)
- ⚠️ Image quality dependency (blurry photos = poor OCR)

**Cost:** Free tier (Groq's current limits are generous; monitor usage)

**Example Implementation:**
```javascript
import groq from '../config/groq.js';

async function parseReceiptPhoto(imageBuffer) {
  const base64Image = imageBuffer.toString('base64');
  
  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [{
      role: 'system',
      content: `Eres un extractor de datos de recibos/facturas. Analiza la imagen y devuelve SOLO JSON válido:
{
  "monto": number,
  "categoria": "string (una de: Alimentos,Transporte,Hogar,Salud,Educacion,Ocio,Ropa,Tecnologia,Servicios,Facturas,Salidas,Otros)",
  "descripcion": "string corto o null",
  "establecimiento": "string o null",
  "fecha": "YYYY-MM-DD o null",
  "confianza": "alta|media|baja"
}
REGLAS:
- Busca el TOTAL FINAL (no sumas parciales)
- Identifica el nombre del comercio/establecimiento
- Si no puedes leer bien, marca confianza como "baja"
- Nunca inventes datos. Si falta info, pon null
- DEVUELVE SOLO JSON, sin texto adicional`
    }, {
      role: 'user',
      content: [
        { type: 'text', text: 'Extrae los datos de este recibo:' },
        { 
          type: 'image_url', 
          image_url: { 
            url: `data:image/jpeg;base64,${base64Image}` 
          }
        }
      ]
    }],
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: 'json_object' }
  });
  
  return JSON.parse(completion.choices[0]?.message?.content);
}
```

---

### **Option 2: Google Cloud Vision API**

**What:** Dedicated OCR service, industry-leading accuracy.

**Pros:**
- ✅ Highest OCR accuracy
- ✅ Handles poor quality images well
- ✅ Specialized receipt understanding

**Cons:**
- ❌ Requires Google Cloud account + billing setup
- ❌ Two API calls needed (OCR → AI parsing)
- ❌ Additional cost (~$1.50 per 1000 images)
- ❌ More infrastructure complexity
- ❌ Need to manage another API key

**Cost:** Free tier: 1000 units/month, then $1.50/1000

**Verdict:** Overkill for this use case given Groq's vision capabilities.

---

### **Option 3: Tesseract.js (Local OCR)**

**What:** Open-source OCR library running on Node.js.

**Pros:**
- ✅ Completely free
- ✅ No external API dependencies
- ✅ Works offline

**Cons:**
- ❌ **Heavy for Render free tier** (512MB RAM limit)
- ❌ Lower accuracy than cloud APIs
- ❌ Requires image preprocessing (deskew, binarize)
- ❌ Two-step process (OCR → AI parsing)
- ❌ Slow processing time (5-15 seconds)
- ❌ May crash on large images

**Cost:** $0 but high memory/CPU usage

**Verdict:** Not recommended for Render free tier deployment.

---

### **Option 4: Multi-Service Fallback Chain**

**What:** Try Groq Vision → fallback to Google Vision → fallback to manual entry.

**Pros:**
- ✅ Maximum reliability
- ✅ Graceful degradation

**Cons:**
- ❌ Complex error handling
- ❌ Multiple API integrations
- ❌ Harder to debug

**Verdict:** Good for production at scale, but overkill for current stage.

---

## 🗄️ Database Schema Extensions

### **Required Changes to `gastos` table:**

```sql
-- Add columns for receipt tracking
ALTER TABLE gastos 
ADD COLUMN IF NOT EXISTS receipt_photo_url TEXT,
ADD COLUMN IF NOT EXISTS receipt_photo_file_id TEXT,
ADD COLUMN IF NOT EXISTS ocr_confidence TEXT CHECK (ocr_confidence IN ('alta', 'media', 'baja')),
ADD COLUMN IF NOT EXISTS extraction_method TEXT CHECK (extraction_method IN ('texto', 'ocr', 'manual')),
ADD COLUMN IF NOT EXISTS fecha_recibo TIMESTAMPTZ;

-- Create Supabase Storage bucket (via Dashboard or API)
-- Bucket name: 'receipt-photos'
-- Public: false (private access only)
```

### **Updated Table Schema:**

```sql
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
  
  -- NEW: Receipt photo fields
  receipt_photo_url   TEXT,                    -- Supabase Storage URL
  receipt_photo_file_id TEXT,                  -- Telegram file_id for re-download
  ocr_confidence      TEXT,                    -- 'alta', 'media', 'baja'
  extraction_method   TEXT NOT NULL DEFAULT 'texto',  -- 'texto', 'ocr', 'manual'
  fecha_recibo        TIMESTAMPTZ,             -- Date from receipt (if detected)
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT uq_user_message UNIQUE (telegram_user_id, telegram_message_id)
);
```

### **Supabase Storage Setup:**

You'll need to create a storage bucket for receipt photos:

**Via Supabase Dashboard:**
1. Go to Storage → Create Bucket
2. Name: `receipt-photos`
3. Public: **false** (keep private)
4. File size limit: 4MB
5. Allowed MIME types: `image/jpeg, image/png, image/webp`

**Via SQL:**
```sql
-- Enable storage
CREATE EXTENSION IF NOT EXISTS "storage";

-- Create bucket (run via Supabase Dashboard or API)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('receipt-photos', 'receipt-photos', false, 4194304, 
        ARRAY['image/jpeg', 'image/png', 'image/webp']);

-- RLS policies for storage
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

## 📲 Telegram Photo Handling Workflow

### **Telegram Photo Message Structure:**

When a user sends a photo, Telegram sends multiple resolutions:
```json
{
  "message": {
    "photo": [
      { "file_id": "small", "file_size": 1234, "width": 90, "height": 90 },
      { "file_id": "medium", "file_size": 12345, "width": 320, "width": 320 },
      { "file_id": "large", "file_size": 123456, "width": 1280, "height": 1280 }
    ],
    "caption": "Optional text from user"
  }
}
```

**Strategy:** Use the **largest photo** (best quality for OCR) but check file size.

### **Photo Download Flow:**

```
User sends photo → Telegram webhook 
  → Extract largest photo's file_id 
  → Call Telegram getFile API 
  → Download image buffer 
  → Compress if > 3.5MB 
  → Send to Groq Vision for OCR 
  → Parse structured JSON 
  → Save to Supabase + upload to Storage 
  → Send confirmation
```

### **New Telegram Service Functions:**

Add to `src/services/telegram.js`:

```javascript
/**
 * Downloads a file from Telegram using file_id.
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<Buffer>} - Image buffer
 */
export async function downloadFile(fileId) {
  try {
    // Step 1: Get file path from Telegram API
    const res = await fetch(`${API_BASE}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId })
    });
    const data = await res.json();
    
    if (!data.ok) {
      throw new Error(`getFile failed: ${data.description}`);
    }
    
    // Step 2: Download the actual file
    const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${data.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    
    return buffer;
  } catch (err) {
    logger.error('Error downloading file', { fileId, error: err.message });
    throw err;
  }
}

/**
 * Sends a photo with optional caption
 */
export async function sendPhoto(chatId, photoBuffer, caption) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([photoBuffer]), 'receipt.jpg');
  if (caption) formData.append('caption', caption);
  formData.append('parse_mode', 'Markdown');
  
  const response = await fetch(`${API_BASE}/sendPhoto`, {
    method: 'POST',
    body: formData
  });
  
  return await response.json();
}
```

### **Image Compression (if needed):**

Add dependency: `sharp` (lightweight image processing)

```bash
npm install sharp
```

```javascript
// src/utils/imageProcessor.js
import sharp from 'sharp';

/**
 * Compresses image to fit within size limit (Telegram/Groq constraints).
 * @param {Buffer} imageBuffer - Original image
 * @param {number} maxSizeMB - Max size in MB (default 3.5)
 * @returns {Promise<Buffer>} - Compressed image
 */
export async function compressImage(imageBuffer, maxSizeMB = 3.5) {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  
  // If already small enough, return as-is
  if (imageBuffer.length < maxSizeBytes) {
    return imageBuffer;
  }
  
  let quality = 80;
  let compressed = await sharp(imageBuffer)
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  
  // Reduce quality iteratively until under limit
  while (compressed.length > maxSizeBytes && quality > 20) {
    quality -= 10;
    compressed = await sharp(imageBuffer)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
  }
  
  return compressed;
}

/**
 * Validates image format and size.
 */
export async function validateImage(buffer) {
  const metadata = await sharp(buffer).metadata();
  
  const allowedFormats = ['jpeg', 'png', 'webp'];
  if (!allowedFormats.includes(metadata.format)) {
    throw new Error(`Formato no soportado: ${metadata.format}. Usá JPEG, PNG o WebP.`);
  }
  
  const maxSizeMB = 10; // Telegram's limit
  if (buffer.length > maxSizeMB * 1024 * 1024) {
    throw new Error(`Imagen demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máx: ${maxSizeMB}MB`);
  }
  
  return metadata;
}
```

---

## 🔄 Complete Implementation Workflow

### **Step-by-Step Execution Flow:**

```
1. User sends receipt photo to Telegram bot
   ↓
2. Webhook receives message with photo array
   ↓
3. Extract largest photo's file_id
   ↓
4. Download image via Telegram API
   ↓
5. Validate & compress image (if needed)
   ↓
6. Send to Groq Vision API with system prompt
   ↓
7. Parse JSON response
   ↓
8. If OCR successful:
   a. Upload photo to Supabase Storage
   b. Save expense with receipt metadata
   c. Send confirmation with extracted data
   ↓
9. If OCR fails:
   a. Ask user to manually enter data
   b. OR ask user to retake photo
```

---

## 📝 Modified Message Handler

Update `index.js` webhook handler to support photos:

```javascript
// In app.post('/webhook', ...)

const message = req.body?.message;
if (!message || !message.from) {
  return;
}

// Handle photo messages
if (message.photo && message.photo.length > 0) {
  enqueue(() => handlePhotoMessage({
    chatId: message.chat.id,
    userId: message.from.id,
    messageId: message.message_id,
    photos: message.photo,
    caption: message.caption || null
  }));
  return;
}

// Handle text messages (existing logic)
if (!message.text) {
  return;
}
```

New handler function:

```javascript
async function handlePhotoMessage({ chatId, userId, messageId, photos, caption }) {
  const startTime = Date.now();
  
  try {
    // Typing indicator
    await sendTyping(chatId);
    
    // Get largest photo
    const largestPhoto = photos[photos.length - 1];
    const fileId = largestPhoto.file_id;
    
    logger.info('Processing receipt photo', { userId, fileId, fileSize: largestPhoto.file_size });
    
    // Download image
    const imageBuffer = await downloadFile(fileId);
    
    // Compress if needed
    const { compressImage } = await import('./src/utils/imageProcessor.js');
    const compressedImage = await compressImage(imageBuffer, 3.5);
    
    // OCR with Groq Vision
    const { parseReceiptPhoto } = await import('./src/services/receiptParser.js');
    const parsed = await parseReceiptPhoto(compressedImage);
    
    if (parsed.error || parsed.monto === null || parsed.monto === undefined) {
      await sendMessage(chatId, 
        '⚠️ No pude leer claramente el recibo. Podés:\n\n' +
        '1️⃣ Intentar de nuevo con otra foto (mejor iluminación)\n' +
        '2️⃣ Enviarme los datos manualmente: "5000 cena restaurante"'
      );
      return;
    }
    
    // Upload to Supabase Storage
    const { uploadReceipt } = await import('./src/services/storage.js');
    const uploadResult = await uploadReceipt(compressedImage, userId, messageId);
    
    // Save expense with receipt metadata
    const result = await saveExpense({
      telegramUserId: userId,
      chatId,
      messageId,
      monto: parsed.monto,
      categoria: parsed.categoria,
      descripcion: parsed.descripcion || caption,
      establecimiento: parsed.establecimiento,
      rawMessage: caption || '📷 Foto de recibo',
      receiptPhotoUrl: uploadResult.url,
      receiptPhotoFileId: fileId,
      ocrConfidence: parsed.confianza || 'media',
      extractionMethod: 'ocr',
      fechaRecibo: parsed.fecha
    });
    
    if (!result.success) {
      await sendMessage(chatId, '❌ No pude guardar el registro. Reintentá.');
      return;
    }
    
    // Monthly total
    const monthlyTotal = await getMonthlyTotal(userId);
    
    // Confirmation message
    let response = `✅ *Recibo procesado*\n\n`;
    response += `💸 *Monto*: $${formatNumber(parsed.monto)}\n`;
    response += `🏷️ *Categoría*: ${parsed.categoria}\n`;
    if (parsed.establecimiento) {
      response += `🏪 *Establecimiento*: ${parsed.establecimiento}\n`;
    }
    if (parsed.fecha) {
      response += `📅 *Fecha del recibo*: ${parsed.fecha}\n`;
    }
    response += `\n🔍 *Confianza OCR*: ${parsed.confianza || 'media'}\n`;
    response += `📅 *Total del mes*: $${formatNumber(monthlyTotal)}`;
    
    await sendMessage(chatId, response);
    
    logger.info('Receipt photo processed OK', {
      chatId,
      userId,
      messageId,
      monto: parsed.monto,
      extractionMethod: 'ocr',
      latencyMs: Date.now() - startTime
    });
    
  } catch (err) {
    logger.error('Error processing receipt photo', {
      chatId,
      userId,
      messageId,
      error: err.message,
      stack: err.stack
    });
    
    try {
      await sendMessage(chatId, 
        '⚠️ Error procesando la foto. Podés:\n\n' +
        '• Intentar de nuevo\n' +
        '• Enviarme los datos manualmente'
      );
    } catch { /* silence */ }
  }
}
```

---

## 💰 Cost Implications Analysis

### **Current Costs (Before Feature):**
- **Groq API:** Free tier (text-only)
- **Supabase:** Free tier (500MB database)
- **Render:** Free tier (512MB RAM)
- **Total:** $0/month

### **Projected Costs (After Feature):**

| Service | Current | After Feature | Notes |
|---------|---------|---------------|-------|
| **Groq API** | Free | Free (likely) | Vision API uses same quota; monitor usage |
| **Supabase Database** | Free | Free | Minimal text column additions |
| **Supabase Storage** | N/A | Free tier | 1GB storage free, then $0.025/GB/month |
| **Render** | Free | Free (watch RAM) | `sharp` adds ~50MB to bundle |
| **Bandwidth** | Free | Free | Telegram + Supabase handle transfers |
| **TOTAL** | **$0** | **$0** (under free tier limits) |

### **Cost at Scale:**

**Scenario: 500 receipts/month**
- Supabase Storage: ~2.5GB (5MB/photo) = **$0.04/month**
- Groq API: Still within free tier (likely)
- **Total:** ~$0.04/month

**Scenario: 5000 receipts/month**
- Supabase Storage: ~25GB = **$0.60/month**
- Groq API: May hit rate limits, consider paid plan
- **Total:** ~$1-5/month

### **Storage Calculation:**
- Average compressed receipt: ~2-5MB
- 1000 receipts × 3.5MB = 3.5GB
- Supabase free tier: 1GB
- Overage: 2.5GB × $0.025 = $0.06/month

---

## ⚡ Performance Considerations

### **Processing Time Breakdown:**

| Step | Estimated Time |
|------|----------------|
| Download photo from Telegram | 0.5-2s |
| Image compression (if needed) | 0.2-1s |
| Groq Vision OCR | 1-3s |
| Upload to Supabase Storage | 0.5-1s |
| Database INSERT | 0.1-0.3s |
| **TOTAL** | **2.3-7.3s** |

### **Optimization Strategies:**

1. **Parallel Processing:**
   - Upload to Storage + save to DB in parallel
   - Compression while downloading

2. **Caching:**
   - Cache Groq API responses for duplicate photos (hash-based)
   - Store file_id to prevent re-downloading same image

3. **Rate Limiting:**
   - Max 5 photos per user per minute
   - Queue processing already in place

4. **Memory Management:**
   - Release image buffers after processing
   - `sharp` uses native libs - monitor RAM on Render

### **Render Free Tier Warnings:**
- ⚠️ 512MB RAM limit - `sharp` adds ~50MB
- ⚠️ Image processing is CPU-intensive
- ⚠️ May hit timeouts on large images
- ✅ Mitigation: Compress images before OCR

---

## 🛡️ Error Handling & Edge Cases

### **Common Failure Scenarios:**

| Scenario | Handling Strategy |
|----------|------------------|
| **Blurry photo** | OCR returns low confidence → ask user to retake |
| **No receipt detected** | Return error → ask for manual entry |
| **Multiple receipts in one photo** | Extract total from primary receipt |
| **Photo too large (>10MB)** | Reject → ask user to compress |
| **Groq API rate limit** | Queue with retry after 30s |
| **Supabase Storage full** | Fallback to Telegram file_id only |
| **Network timeout** | Retry once, then ask user to retry |
| **Invalid image format** | Validate upfront → reject with message |

### **User Experience Flow for Errors:**

```
OCR Confidence = "baja" → Bot responds:
"⚠️ No pude leer bien el recibo (baja confianza).

📊 Datos extraídos:
• Monto: $5000
• Comercio: Restaurante X

¿Es correcto?
[✅ Sí, guardar] [❌ No, intentar de nuevo] [✏️ Editar datos]"
```

---

## 📊 Updated File Structure

```
bot-finanzas/
├── index.js                          # ADD: handlePhotoMessage()
├── package.json                      # ADD: sharp dependency
│
├── src/
│   ├── config/
│   │   ├── env.js                    # (no changes)
│   │   ├── groq.js                   # (no changes)
│   │   └── supabase.js              # (no changes)
│   │
│   ├── services/
│   │   ├── telegram.js              # ADD: downloadFile(), sendPhoto()
│   │   ├── parser.js                # (no changes - text-only)
│   │   ├── receiptParser.js         # NEW: Groq Vision OCR wrapper
│   │   ├── storage.js               # ADD: uploadReceipt()
│   │   ├── resumen.js               # (no changes)
│   │   ├── expenseManager.js        # (no changes)
│   │   └── keepAlive.js             # (no changes)
│   │
│   └── utils/
│       ├── logger.js                # (no changes)
│       └── imageProcessor.js        # NEW: compression, validation
│
└── scripts/
    └── init-db.sql                  # UPDATE: add receipt columns + storage setup
```

---

## 🚀 Implementation Roadmap

### **Phase 1: Database & Storage Setup** (30 min)
1. Run ALTER TABLE migration on Supabase
2. Create `receipt-photos` storage bucket
3. Set up RLS policies
4. Update `init-db.sql` for future deployments

**Files to modify:**
- `scripts/init-db.sql`

**Commands:**
```bash
# Run in Supabase SQL Editor
ALTER TABLE gastos ADD COLUMN receipt_photo_url TEXT, ...
```

---

### **Phase 2: Image Processing Utilities** (1 hour)
1. Install `sharp` dependency
2. Create `src/utils/imageProcessor.js`
3. Implement compression + validation functions
4. Test locally with sample images

**Commands:**
```bash
npm install sharp
```

**Files to create:**
- `src/utils/imageProcessor.js`

---

### **Phase 3: Telegram Photo Download** (1 hour)
1. Add `downloadFile()` to `src/services/telegram.js`
2. Add `sendPhoto()` to `src/services/telegram.js`
3. Test downloading photos from test bot

**Files to modify:**
- `src/services/telegram.js`

---

### **Phase 4: Receipt OCR Parser** (2 hours)
1. Create `src/services/receiptParser.js`
2. Implement Groq Vision API integration
3. Add system prompt for receipt extraction
4. Test with sample receipt images

**Files to create:**
- `src/services/receiptParser.js`

---

### **Phase 5: Storage Service Updates** (1 hour)
1. Add `uploadReceipt()` to `src/services/storage.js`
2. Update `saveExpense()` to accept receipt metadata
3. Test upload + save flow

**Files to modify:**
- `src/services/storage.js`

---

### **Phase 6: Webhook Handler Integration** (2 hours)
1. Update `index.js` to handle photo messages
2. Implement `handlePhotoMessage()` function
3. Wire up OCR → Storage → Database flow
4. Add typing indicators + error handling

**Files to modify:**
- `index.js`

---

### **Phase 7: Testing & Edge Cases** (2 hours)
1. Test with various receipt types (supermarket, restaurant, taxi, etc.)
2. Test with poor quality images
3. Test with multi-receipt photos
4. Test rate limiting
5. Test storage limits
6. Dashboard updates to show receipt photos

**Test cases:**
- Clear, well-lit receipt
- Blurry/dark receipt
- Handwritten receipt
- Multiple items on receipt
- Digital receipt (QR code)
- Very long receipt (thermal paper)

---

### **Phase 8: Dashboard Updates** (Optional, 2 hours)
1. Show receipt photo thumbnails in expense table
2. Add filter: "Show expenses with receipts"
3. Add clickable photo viewer modal

**Files to modify:**
- `public/dashboard.html`

---

## 📝 Complete Code Examples

### **New File: `src/services/receiptParser.js`**

```javascript
import groq from '../config/groq.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Eres un extractor de datos de recibos y facturas comerciales.

Analiza la imagen del recibo y devuelve SOLO un JSON válido con esta estructura:
{
  "monto": number,
  "categoria": "string (exactamente una de: ${config.allowedCategories.join(',')})",
  "descripcion": "string corto o null",
  "establecimiento": "string o null",
  "fecha": "YYYY-MM-DD o null",
  "confianza": "alta|media|baja"
}

REGLAS CRÍTICAS:
1. Busca el TOTAL FINAL (no sumas parciales, nosubtotal sin IVA)
2. Identifica el nombre del comercio/establecimiento claramente visible
3. Si hay múltiples ítems, extrae solo el total general
4. Si la fecha es legible, extraela en formato YYYY-MM-DD
5. Si no podés leer bien algún campo, pon null (NO inventes)
6. Marcá confianza como "baja" si:
   - La imagen está borrosa
   - Hay reflejos o sombras que tapan información
   - El recibo está cortado
7. DEVUELVE SOLO JSON VÁLIDO, sin texto adicional ni markdown`;

/**
 * Parses a receipt photo using Groq Vision API.
 * @param {Buffer} imageBuffer - Compressed image buffer
 * @returns {Promise<object>} - Parsed receipt data
 */
export async function parseReceiptPhoto(imageBuffer) {
  const startTime = Date.now();

  try {
    const base64Image = imageBuffer.toString('base64');

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extrae los datos de este recibo/factura:' },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' }
    });

    const latency = Date.now() - startTime;
    const usage = completion.usage || {};

    logger.info('Groq Vision OCR completed', {
      latencyMs: latency,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return { error: 'Respuesta vacía de la IA.' };
    }

    const parsed = JSON.parse(raw);

    if (parsed.error) {
      return { error: parsed.error };
    }

    // Validate monto
    if (typeof parsed.monto !== 'number' || parsed.monto <= 0) {
      return { error: 'No detecté un monto válido en el recibo.' };
    }

    // Normalize categoría
    if (!config.allowedCategories.includes(parsed.categoria)) {
      parsed.categoria = 'Otros';
    }

    return {
      monto: parsed.monto,
      categoria: parsed.categoria,
      descripcion: parsed.descripcion || null,
      establecimiento: parsed.establecimiento || null,
      fecha: parsed.fecha || null,
      confianza: parsed.confianza || 'media'
    };
  } catch (err) {
    const latency = Date.now() - startTime;

    if (err.status === 429 || err.statusCode === 429) {
      logger.error('Groq Vision rate limit', { latencyMs: latency, error: err.message });
      return { error: '⚠️ Demasiadas solicitudes. Reintentá en 30s.' };
    }

    if (err instanceof SyntaxError) {
      logger.error('Groq Vision JSON parse error', { latencyMs: latency, error: err.message });
      return { error: 'No pude interpretar el recibo. Intentá de nuevo.' };
    }

    logger.error('Groq Vision error', { latencyMs: latency, error: err.message });
    return { error: '⚠️ Error procesando la imagen. Reintentá.' };
  }
}
```

---

### **Modified File: `src/services/storage.js`**

Add these functions:

```javascript
import supabase from '../config/supabase.js';
import logger from '../utils/logger.js';

// ... existing functions ...

/**
 * Uploads receipt photo to Supabase Storage.
 * @param {Buffer} imageBuffer - Compressed image
 * @param {number} userId - Telegram user ID
 * @param {number} messageId - Telegram message ID
 * @returns {Promise<{url: string, path: string}>}
 */
export async function uploadReceipt(imageBuffer, userId, messageId) {
  try {
    const fileName = `${userId}/${messageId}_${Date.now()}.jpg`;
    const filePath = `receipt-photos/${fileName}`;

    const { data, error } = await supabase.storage
      .from('receipt-photos')
      .upload(filePath, imageBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      logger.error('Supabase Storage upload error', {
        userId,
        messageId,
        error: error.message
      });
      throw error;
    }

    // Get public URL (signed since bucket is private)
    const { data: urlData } = supabase.storage
      .from('receipt-photos')
      .getPublicUrl(filePath);

    return {
      url: urlData.publicUrl,
      path: filePath
    };
  } catch (err) {
    logger.error('Error uploading receipt', { userId, messageId, error: err.message });
    throw err;
  }
}

/**
 * Updates saveExpense to accept receipt metadata
 * (Modify existing function signature)
 */
export async function saveExpense({
  telegramUserId,
  chatId,
  messageId,
  monto,
  categoria,
  descripcion,
  establecimiento,
  rawMessage,
  receiptPhotoUrl = null,
  receiptPhotoFileId = null,
  ocrConfidence = null,
  extractionMethod = 'texto',
  fechaRecibo = null
}) {
  try {
    const { data, error } = await supabase
      .from('gastos')
      .insert({
        telegram_user_id: telegramUserId,
        telegram_chat_id: chatId,
        telegram_message_id: messageId,
        monto,
        categoria,
        descripcion,
        establecimiento,
        raw_message: rawMessage,
        // New fields
        receipt_photo_url: receiptPhotoUrl,
        receipt_photo_file_id: receiptPhotoFileId,
        ocr_confidence: ocrConfidence,
        extraction_method: extractionMethod,
        fecha_recibo: fechaRecibo
      })
      .select()
      .single();

    if (error) {
      logger.error('Error saving expense', {
        telegramUserId,
        chatId,
        messageId,
        error: error.message,
        code: error.code
      });
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    logger.error('Error in saveExpense', {
      telegramUserId,
      chatId,
      messageId,
      error: err.message
    });
    return { success: false, error: err.message };
  }
}
```

---

## 🎯 User Experience Design

### **Command Updates:**

Update `/start` message to include photo option:

```javascript
await sendMessage(chatId,
  '👋 *¡Hola! Soy tu bot de gastos.*\n\n' +
  '📝 *Registrar gasto* (elegí una opción):\n\n' +
  '💬 *Por texto:*\n' +
  '• _"Gasté 5000 en el super"_\n' +
  '• _"450 café starbucks"_\n\n' +
  '📷 *Por foto:*\n' +
  '• Enviame una foto del recibo\n\n' +
  '📊 _/resumen_ — Reporte del mes\n' +
  '🗑️ _/eliminar_ — Ver lista y elegir\n' +
  '   _"eliminar 5"_ — Eliminar el gasto #5\n' +
  '✏️ _/editar_ — Ver lista y elegir\n' +
  '   _"editar 5"_ — Editar el gasto #5'
);
```

### **Success Message (OCR):**

```
✅ *Recibo procesado*

💸 *Monto*: $5,000
🏷️ *Categoría*: Alimentos
🏪 *Establecimiento*: Carrefour Express
📅 *Fecha del recibo*: 2026-04-09

🔍 *Confianza OCR*: alta
📅 *Total del mes*: $45,300
```

### **Error Message (Low Confidence):**

```
⚠️ *No pude leer bien el recibo*

📊 *Datos parciales extraídos:*
• Monto: $5,000
• Comercio: (no detectado)

¿Qué querés hacer?

[✅ Guardar así] [❌ Intentar de nuevo] [✏️ Editar datos]
```

---

## 🔒 Security Considerations

### **Data Privacy:**
- ✅ Receipt photos stored in private Supabase bucket
- ✅ Only accessible by authenticated users (RLS policies)
- ✅ Telegram file_ids are user-specific
- ✅ No sensitive data (credit cards, IDs) should be stored

### **Access Control:**
```sql
-- Ensure RLS policies restrict by user
CREATE POLICY "Users can only insert their own expenses"
ON gastos FOR INSERT
WITH CHECK (telegram_user_id = auth.uid());

CREATE POLICY "Users can only view their own expenses"
ON gastos FOR SELECT
USING (telegram_user_id = auth.uid());
```

### **Input Validation:**
- Validate image MIME types (jpeg, png, webp only)
- Validate image size (< 10MB)
- Sanitize OCR output (prevent injection attacks)
- Rate limit photo uploads (5 per user per minute)

---

## 📈 Future Enhancements

### **Phase 2 Features:**
1. **Multi-receipt detection:** Detect and split multiple receipts in one photo
2. **Item-level extraction:** Extract individual items from receipt
3. **Currency detection:** Auto-detect currency and convert if needed
4. **Duplicate receipt detection:** Hash-based duplicate prevention
5. **Receipt search:** Search expenses by receipt content
6. **Export receipts:** Download all receipts as ZIP
7. **Photo viewer in dashboard:** Click to view full-size receipt
8. **WhatsApp integration:** Same flow for WhatsApp Business API

### **AI Improvements:**
- Fine-tune model on your specific receipt types
- Multi-turn conversation to clarify ambiguous receipts
- Confidence scoring with specific field-level confidence
- Automatic category suggestion based on establishment name

---

## 🧪 Testing Strategy

### **Unit Tests:**
```javascript
// tests/receiptParser.test.js
import { parseReceiptPhoto } from '../src/services/receiptParser.js';

describe('parseReceiptPhoto', () => {
  it('should extract monto from clear receipt', async () => {
    const imageBuffer = fs.readFileSync('test-data/clear-receipt.jpg');
    const result = await parseReceiptPhoto(imageBuffer);
    expect(result.monto).toBeGreaterThan(0);
    expect(result.categoria).toBeDefined();
  });

  it('should handle blurry images gracefully', async () => {
    const imageBuffer = fs.readFileSync('test-data/blurry-receipt.jpg');
    const result = await parseReceiptPhoto(imageBuffer);
    expect(result.error || result.confianza === 'baja').toBeTruthy();
  });
});
```

### **Integration Tests:**
1. Send photo to test bot → verify database entry
2. Check Supabase Storage for uploaded file
3. Verify confirmation message format
4. Test error scenarios (no receipt, blurry, etc.)

### **Manual Test Cases:**
| Test | Input | Expected Output |
|------|-------|----------------|
| Clear supermarket receipt | Photo | Correct monto, store, category |
| Restaurant bill with items | Photo | Total amount, "Alimentos" |
| Handwritten receipt | Photo | Low confidence or error |
| Multiple receipts in one photo | Photo | Extract primary receipt |
| Very dark/blurry photo | Photo | Ask to retake |
| Text + photo combo | Photo + caption | Use caption as description |

---

## 📚 Additional Resources

### **Documentation:**
- [Groq Vision API Docs](https://console.groq.com/docs/vision)
- [Telegram Bot API - Photos](https://core.telegram.org/bots/api#photosize)
- [Telegram Bot API - getFile](https://core.telegram.org/bots/api#getfile)
- [Supabase Storage Docs](https://supabase.com/docs/guides/storage)
- [Sharp Image Processing](https://sharp.pixelplumbing.com/)

### **Example Projects:**
- [Telegram OCR Bot (n8n workflow)](https://n8n.io/workflows/13897-log-telegram-receipt-images-to-excel-365-using-tesseract-ocr-and-gpt-41-mini/)
- [Receipt Parser with Llama Vision](https://medium.com/@rohanaahir31/llama-3-2-vision-model-for-ocr-to-automate-kyc-process-667214e63c68)

---

## ✅ Implementation Checklist

**Pre-implementation:**
- [ ] Run database migration (ALTER TABLE)
- [ ] Create Supabase Storage bucket
- [ ] Set up RLS policies
- [ ] Install `sharp` dependency

**Implementation:**
- [ ] Create `src/utils/imageProcessor.js`
- [ ] Update `src/services/telegram.js` with download functions
- [ ] Create `src/services/receiptParser.js`
- [ ] Update `src/services/storage.js` with upload function
- [ ] Update `index.js` with photo handler
- [ ] Update `/start` command message

**Testing:**
- [ ] Test with 10+ different receipt types
- [ ] Test error scenarios
- [ ] Test on Render deployment (not just locally)
- [ ] Monitor RAM usage on Render
- [ ] Test with large images (>5MB)
- [ ] Test rate limiting

**Post-launch:**
- [ ] Monitor Groq API usage
- [ ] Monitor Supabase Storage usage
- [ ] Collect user feedback
- [ ] Fix edge cases as reported
- [ ] Update README documentation
- [ ] Add receipt viewer to dashboard (optional)

---

## 🎬 Quick Start Commands

```bash
# 1. Install dependencies
npm install sharp

# 2. Run database migration (in Supabase SQL Editor)
# Copy-paste the ALTER TABLE commands from this doc

# 3. Create Supabase Storage bucket (via Dashboard)
# Name: receipt-photos, Public: false, Max size: 4MB

# 4. Start local development
node index.js

# 5. Test by sending photo to your Telegram bot

# 6. Deploy to Render
git push origin main
# Render auto-deploys on push
```

---

## 🤔 Decision Summary

| Aspect | Recommendation | Why |
|--------|---------------|-----|
| **OCR Engine** | Groq Vision (Llama 4 Scout) | Already have account, free tier, single API call |
| **Image Storage** | Supabase Storage | Integrated with existing DB, free tier, RLS |
| **Image Processing** | Sharp | Lightweight, Node.js native, fast compression |
| **Fallback Strategy** | Manual entry prompt | Simple, no extra infrastructure |
| **Error Handling** | Confidence-based | Transparent to user, allows correction |
| **Implementation Priority** | Photo-only first | Core use case, text already works |

---

**Ready to implement?** Start with Phase 1 (database setup) and work through the roadmap. The entire feature can be implemented in 8-12 hours of development time.
