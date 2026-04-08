# 💰 Gastos Bot — Telegram

Bot de registro de gastos personales vía Telegram. Usa IA (Groq/Llama 3.1) para extraer montos y categorías de mensajes en lenguaje natural y almacena en Supabase.

## Arquitectura

```
Usuario → Telegram → Webhook (Express) → Cola async → Groq AI → Supabase
                                                                    ↓
                                                              Confirmación
```

**Decisiones clave:**
- **Webhook-driven**: Respuesta HTTP 200 inmediata. Procesamiento en cola async en memoria.
- **Idempotencia**: `telegram_user_id` + `telegram_message_id` como UNIQUE constraint.
- **Resiliencia**: Si Groq o Supabase fallan, el bot responde amigablemente sin crashear.
- **Cero dependencias externas**: Sin Redis, sin Bull, sin colas pagadas.

## Stack

| Componente | Tecnología |
|---|---|
| Runtime | Node.js 20+ (ESM) |
| Server | Express 4 |
| IA | Groq SDK (llama-3.1-8b-instant) |
| Base de datos | Supabase (PostgreSQL) |
| Logging | Winston |
| Hosting | Render (free tier) |

## Requisitos previos

1. **Bot de Telegram**: Crearlo con [@BotFather](https://t.me/BotFather) y obtener el token.
2. **Cuenta Groq**: [console.groq.com](https://console.groq.com) — obtener API Key gratuita.
3. **Proyecto Supabase**: [supabase.com](https://supabase.com) — crear proyecto y obtener URL + service_role key.
4. **Cuenta Render**: [render.com](https://render.com) — plan gratuito.

## Instalación local

```bash
# 1. Clonar e instalar
cd bot-finanzas
npm install

# 2. Configurar variables de entorno
cp .env .env.local
# Editar .env con tus valores reales

# 3. Crear la tabla en Supabase
# Ir a Supabase Dashboard > SQL Editor > New Query
# Pegar y ejecutar el contenido de scripts/init-db.sql

# 4. Ejecutar en desarrollo
npm run dev
```

Para recibir webhooks localmente, usar [ngrok](https://ngrok.com):

```bash
ngrok http 3000
# Copiar la URL HTTPS y ponerla en WEBHOOK_BASE_URL en .env
```

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `NODE_ENV` | Entorno | `production` |
| `TELEGRAM_BOT_TOKEN` | Token de BotFather | `123456:ABC-DEF...` |
| `GROQ_API_KEY` | API Key de Groq | `gsk_...` |
| `SUPABASE_URL` | URL del proyecto Supabase | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | Service role key de Supabase | `eyJ...` |
| `WEBHOOK_BASE_URL` | URL pública del servidor | `https://tu-app.onrender.com` |
| `ALLOWED_CATEGORIES` | Categorías permitidas (CSV) | `Alimentos,Transporte,...` |

## Deploy en Render

### Paso a paso

1. **Crear repositorio Git** y pushear el proyecto:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: gastos-bot"
   git remote add origin https://github.com/tu-usuario/bot-finanzas.git
   git push -u origin main
   ```

2. **En Render Dashboard** ([dashboard.render.com](https://dashboard.render.com)):
   - Click **New** → **Web Service**
   - Conectar el repositorio de GitHub
   - Configurar:
     - **Name**: `gastos-bot`
     - **Runtime**: `Node`
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Instance Type**: Free
   - En **Environment Variables**, agregar todas las variables de `.env`
   - **IMPORTANTE**: `WEBHOOK_BASE_URL` = la URL que Render te asigna (ej: `https://gastos-bot.onrender.com`)

3. **Deploy**: Render hace deploy automáticamente al pushear a `main`.

4. **Verificar**:
   - Visitar `https://gastos-bot.onrender.com/` — debe devolver `{"status":"ok"}`
   - Enviar un mensaje al bot en Telegram
   - El primer mensaje puede tardar ~30s si Render hizo cold start

### Notas importantes sobre Render Free Tier

- El servicio se duerme después de 15 minutos de inactividad.
- El primer mensaje tras dormir tarda ~30-60s (cold start).
- Para mantenerlo activo, configurar un cron externo (ej: [cron-job.org](https://cron-job.org)) que haga GET a `/health` cada 14 minutos.

## Uso del bot

| Acción | Ejemplo |
|---|---|
| Registrar gasto | `Gasté 5000 en el super` |
| Formato libre | `450 café starbucks` |
| Otro formato | `Uber 2300` |
| Ver resumen | `/resumen` |
| Ver ayuda | `/start` |

## Checklist de validación pre-lanzamiento

- [ ] Variables de entorno configuradas en Render
- [ ] Tabla `gastos` creada en Supabase (ejecutar `init-db.sql`)
- [ ] Endpoint `/health` responde 200
- [ ] Bot responde a `/start`
- [ ] Bot parsea un gasto simple (ej: "500 café")
- [ ] Gasto aparece en tabla `gastos` de Supabase
- [ ] `/resumen` devuelve datos después de registrar gastos
- [ ] Mensaje duplicado (reenviar el mismo) es ignorado
- [ ] Mensaje sin monto devuelve error amigable
- [ ] Si Groq falla (API key inválida), el bot responde sin crashear

## Roadmap — Deuda técnica y escalabilidad

### Fase 1 — Optimización inmediata
- [ ] Usar función RPC `resumen_mensual` en vez de fallback JS (ya creada en `init-db.sql`)
- [ ] Agregar keep-alive cron para evitar cold starts de Render
- [ ] Rate limiting por usuario (prevenir abuso)

### Fase 2 — Features
- [ ] Comando `/eliminar` para borrar el último gasto
- [ ] Comando `/export` que genera CSV del mes
- [ ] Soporte multi-moneda (USD/ARS) con tipo de cambio
- [ ] Gastos recurrentes programados

### Fase 3 — Escalabilidad
- [ ] Migrar cola en memoria a Redis/BullMQ si el volumen lo justifica
- [ ] Agregar Sentry para error tracking
- [ ] Dashboard web con gráficos (Supabase + Chart.js)
- [ ] Multi-usuario con autenticación por Telegram ID (ya preparado)

### Fase 4 — Monetización (opcional)
- [ ] Plan premium con reportes avanzados
- [ ] Integración con bancos (scraping o APIs)
- [ ] Alertas de presupuesto por categoría
