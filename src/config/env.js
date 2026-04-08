// src/config/env.js
import 'dotenv/config';
import logger from '../utils/logger.js';

const REQUIRED_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'GROQ_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'WEBHOOK_BASE_URL'
];

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  logger.error(`Variables de entorno faltantes: ${missing.join(', ')}`);
  process.exit(1);
}

const config = Object.freeze({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    webhookUrl: `${process.env.WEBHOOK_BASE_URL}/webhook`
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.1-8b-instant'
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY
  },
  allowedCategories: (process.env.ALLOWED_CATEGORIES || 'Otros').split(',').map((c) => c.trim())
});

export default config;
