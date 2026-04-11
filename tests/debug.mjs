// debug.mjs
import 'dotenv/config';

console.log("🔍 DIAGNÓSTICO DE CONEXIÓN");
console.log("----------------------------");

// 1. Verificar Variables de Entorno
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;

console.log("1. TELEGRAM_TOKEN:", telegramToken ? `✅ Cargado (longitud: ${telegramToken.length})` : "❌ NO ENCONTRADO");
console.log("2. SUPABASE_URL:", supabaseUrl || "❌ NO ENCONTRADO");

if (!telegramToken) {
  console.error("🛑 ERROR: El token de Telegram no se cargó. Revisa tu archivo .env");
  process.exit(1);
}

// 2. Probar conexión a Telegram API
console.log("\n3. Probando conexión a Telegram API...");
try {
  const url = `https://api.telegram.org/bot${telegramToken}/getMe`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.ok) {
    console.log("✅ Telegram API: OK (Bot nombre:", data.result.first_name, ")");
  } else {
    console.log("⚠️ Telegram API respondió, pero hubo error:", data);
  }
} catch (error) {
  console.error("❌ Telegram API FALLÓ:", error.message);
}

// 3. Probar conexión a Supabase (usando fetch nativo para ir directo)
console.log("\n4. Probando conexión a Supabase...");
try {
  // Solo probamos que el servidor responda ping
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { 'apikey': process.env.SUPABASE_KEY }
  });
  
  // Supabase devuelve 401 o 400 si no hay query, pero si responde algo, hay conexión
  console.log("✅ Supabase responde (Status:", response.status, ")");
} catch (error) {
  console.error("❌ Supabase FALLÓ:", error.message);
}

console.log("\n----------------------------");
console.log("Fin del diagnóstico.");
