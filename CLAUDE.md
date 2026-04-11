# gastos-bot — CLAUDE.md

Bot de Telegram personal para registro de gastos. Usuario único: Felipe Valor.
Lenguaje: **español rioplatense** en todos los mensajes al usuario.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20+ ESM (`"type": "module"`) |
| HTTP | Express 4.x |
| IA texto | Groq SDK — `llama-3.1-8b-instant` |
| IA visión (OCR) | Groq Vision — `meta-llama/llama-4-scout-17b-16e-instruct` |
| DB | Supabase (PostgreSQL) |
| Storage | Supabase Storage — bucket `receipt-photos` |
| Imágenes | sharp |
| Logs | Winston (`src/utils/logger.js`) |
| Deploy | Render (free tier — keepAlive activo) |

---

## Estructura

```
index.js              ← entry point: Express + webhook handler + cola de mensajes
src/
  config/
    env.js            ← valida vars de entorno al arrancar, exporta config frozen
    groq.js           ← cliente Groq SDK
    supabase.js       ← cliente Supabase
  services/
    parser.js         ← parsea texto libre → gasto (Groq JSON mode)
    receiptParser.js  ← OCR de foto de recibo (Groq Vision)
    intentDetector.js ← detecta intención NL: create/delete/edit/summary
    expenseManager.js ← flujos multi-paso de edición/eliminación (inline keyboard)
    storage.js        ← CRUD Supabase: gastos + Supabase Storage
    resumen.js        ← resumen mensual por categoría
    telegram.js       ← wrapper Telegram Bot API
    keepAlive.js      ← ping periódico para mantener Render activo
  utils/
    logger.js         ← Winston logger
    imageProcessor.js ← sharp: compresión + selección foto más grande
public/
  dashboard.html      ← dashboard web estático
scripts/
  init-db.sql         ← schema inicial Supabase
  migracion_recibos.sql ← migración para campos OCR
tests/
  *.mjs               ← scripts de prueba manuales
  fixtures/           ← foto de recibo de prueba
docs/                 ← notas de implementación y diagnóstico
```

---

## Base de datos (Supabase)

Tabla: `gastos`

```sql
id                  BIGSERIAL PK
telegram_user_id    BIGINT
telegram_chat_id    BIGINT
telegram_message_id BIGINT
monto               NUMERIC(12,2) CHECK > 0
categoria           TEXT DEFAULT 'Otros'
descripcion         TEXT
establecimiento     TEXT
raw_message         TEXT
receipt_photo_url   TEXT       -- URL pública Supabase Storage
receipt_photo_file_id TEXT     -- file_id Telegram para re-descargar
ocr_confidence      TEXT       -- alta|media|baja
extraction_method   TEXT       -- texto|ocr|manual
fecha_recibo        TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT NOW()

UNIQUE (telegram_user_id, telegram_message_id)  -- idempotencia
```

RPC disponible: `resumen_mensual(p_user_id, p_year, p_month)`

---

## Variables de entorno

**Requeridas** (el proceso muere si faltan — ver `src/config/env.js`):

```
TELEGRAM_BOT_TOKEN
GROQ_API_KEY
SUPABASE_URL
SUPABASE_KEY
WEBHOOK_BASE_URL     # URL pública del servidor en Render (sin trailing slash)
```

**Opcionales:**

```
PORT                 # default 3000
NODE_ENV             # default development
ALLOWED_CATEGORIES   # CSV, default: Alimentos,Transporte,Hogar,...
```

---

## Comandos de desarrollo

```bash
npm run dev    # node --watch (recarga automática)
npm start      # producción
```

No hay test runner configurado. Los archivos en `tests/` son scripts manuales.

---

## Arquitectura del webhook

1. Telegram llama `POST /webhook`
2. Express responde **200 inmediato** (< 300ms — requisito Telegram)
3. El mensaje se encola en `messageQueue` (array en memoria)
4. `processQueue()` procesa de a uno (FIFO, single-consumer)

Esto evita timeouts de Telegram y serializa el procesamiento por defecto.

---

## Flujo de mensajes

```
Mensaje texto → detectIntent() → [summary|delete|edit] → handler específico
                               → [create|other] → parseExpense() → saveExpense()

Foto → downloadFile() → compressImage() → parseReceiptPhoto() → saveExpense()
                                                                → uploadReceipt()
```

---

## Sesiones en memoria

`expenseManager.js` mantiene un Map en memoria para flujos multi-paso (editar campo a campo con inline keyboard). Las sesiones expiran. No hay persistencia — un restart del servidor las borra.

---

## Categorías

`Alimentos, Transporte, Hogar, Salud, Educación, Ocio, Ropa, Tecnología, Servicios, Facturas, Salidas, Otros`

Configurables vía `ALLOWED_CATEGORIES` env var (CSV).

---

## Endpoints HTTP

| Método | Path | Descripción |
|--------|------|-------------|
| GET | `/` | Health check con uptime |
| GET | `/health` | Health check simple |
| GET | `/diag` | Diagnóstico: env vars + test Supabase + test Groq |
| POST | `/webhook` | Webhook Telegram |
| GET | `/*` | Archivos estáticos de `public/` |

---

## Consideraciones de código

- Todo el código usa **ES modules** (`import/export`) — no `require()`
- El logger es Winston — no usar `console.log` en producción
- Groq se usa con `response_format: { type: 'json_object' }` para parseo de texto
- Groq Vision recibe imagen como base64 en content array
- Imágenes se comprimen a máx 3.5MB antes de enviar a Groq (límite API)
- `saveExpense()` es idempotente por la constraint UNIQUE en DB
- Todos los mensajes al usuario van en español rioplatense con emojis
- Números se formatean con `es-AR` locale (ej: `$1.700`)
- El bot corre en Render free tier — `keepAlive.js` hace ping cada N minutos para evitar sleep

---

## Deploy (Render)

- Push a `main` → deploy automático
- `WEBHOOK_BASE_URL` debe apuntar a la URL de Render
- El webhook se registra automáticamente al arrancar (`setWebhook()` en startup)
- Render puede dormir la instancia en free tier → keepAlive previene esto
