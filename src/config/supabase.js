// src/config/supabase.js
import { createClient } from '@supabase/supabase-js';
import config from './env.js';

if (!config.supabase.url || !config.supabase.key) {
  throw new Error('Faltan variables de entorno de Supabase');
}

// Crear cliente con fetch explícito (soluciona "fetch failed")
const supabase = createClient(config.supabase.url, config.supabase.key, {
  global: {
    fetch: fetch
  }
});

export default supabase;
