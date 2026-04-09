// index.js — Entry point
import express from 'express';
import config from './src/config/env.js';
import logger from './src/utils/logger.js';
import { sendTyping, sendMessage, setWebhook, answerCallbackQuery } from './src/services/telegram.js';
import { parseExpense } from './src/services/parser.js';
import { isDuplicate, saveExpense, getMonthlyTotal } from './src/services/storage.js';
import { getResumen } from './src/services/resumen.js';
import supabase from './src/config/supabase.js';
import groq from './src/config/groq.js';
import {
  handleEliminarCommand,
  handleEditarCommand,
  handleDeleteSelection,
  handleEditSelection,
  handleConfirmDelete,
  handleCancel,
  handleFieldSelection,
  handleCategorySelection,
  handleEditInput,
  cleanupExpiredSessions,
  handleDeleteById,
  handleEditById
} from './src/services/expenseManager.js';
import { startKeepAlive } from './src/services/keepAlive.js';

// ─── Cola en memoria ─────────────────────────────────────────────
const messageQueue = [];
let processing = false;

function enqueue(task) {
  messageQueue.push(task);
  processQueue();
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (messageQueue.length > 0) {
    const task = messageQueue.shift();
    try {
      await task();
    } catch (err) {
      logger.error('Error procesando tarea de cola', { error: err.message, stack: err.stack });
    }
  }

  processing = false;
}

// ─── Express App ──────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Servir archivos estáticos del dashboard
app.use(express.static('public'));

// Health check
app.get('/', (_req, res) => {
  res.json({ status: 'ok', bot: 'gastos-bot', uptime: process.uptime() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Diagnostic endpoint (only in production)
app.get('/diag', async (_req, res) => {
  const results = { env: {}, supabase: {}, groq: {} };

  // Check env vars (mask sensitive parts)
  results.env.SUPABASE_URL = process.env.SUPABASE_URL;
  results.env.SUPABASE_KEY = process.env.SUPABASE_KEY ? `${process.env.SUPABASE_KEY.substring(0, 20)}...` : 'MISSING';
  results.env.GROQ_API_KEY = process.env.GROQ_API_KEY ? `${process.env.GROQ_API_KEY.substring(0, 10)}...` : 'MISSING';
  results.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ? 'SET' : 'MISSING';
  results.env.WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;
  results.env.NODE_ENV = process.env.NODE_ENV;

  // Test Supabase
  try {
    const { data, error } = await supabase.from('gastos').select('id').limit(1);
    results.supabase = data ? { ok: true, rows: data.length } : { error: error?.message || 'unknown', code: error?.code, details: JSON.stringify(error) };
  } catch (e) {
    results.supabase = { error: e.message };
  }

  // Test Groq
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'say pong' }],
      max_tokens: 10
    });
    results.groq = { ok: true, response: completion.choices[0]?.message?.content };
  } catch (e) {
    results.groq = { error: e.message, status: e.status, statusCode: e.statusCode };
  }

  res.json(results);
});

// ─── Webhook endpoint ────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  // Responder HTTP 200 inmediatamente (<300ms)
  res.sendStatus(200);

  // Route callback queries
  if (req.body?.callback_query) {
    enqueue(() => handleCallbackQuery(req.body.callback_query));
    return;
  }

  const message = req.body?.message;
  if (!message || !message.text || !message.from) {
    return;
  }

  const chatId = message.chat.id;
  const userId = message.from.id;
  const messageId = message.message_id;
  const text = message.text.trim();

  // Encolar el procesamiento asíncrono
  enqueue(() => handleMessage({ chatId, userId, messageId, text }));
});

// ─── Callback Query Handler ──────────────────────────────────────
async function handleCallbackQuery(query) {
  const userId = query.from.id;
  const data = query.data;

  try {
    if (data.startsWith('del:')) {
      await handleDeleteSelection(query, userId);
    } else if (data.startsWith('edit:')) {
      await handleEditSelection(query, userId);
    } else if (data === 'confirm:yes') {
      await handleConfirmDelete(query, userId);
    } else if (data === 'confirm:no' || data === 'cancel') {
      await handleCancel(query, userId);
    } else if (data.startsWith('field:')) {
      const field = data.split(':')[1];
      await handleFieldSelection(query, userId, field);
    } else if (data.startsWith('cat:')) {
      const category = data.split(':')[1];
      await handleCategorySelection(query, userId, category);
    } else {
      await answerCallbackQuery(query.id, '❌ Acción no reconocida');
    }
  } catch (err) {
    logger.error('Error en handleCallbackQuery', { userId, data, error: err.message });
    try {
      await answerCallbackQuery(query.id, '⚠️ Error procesando la acción');
    } catch { /* silenciar */ }
  }
}

// ─── Handler principal ───────────────────────────────────────────
async function handleMessage({ chatId, userId, messageId, text }) {
  const startTime = Date.now();

  try {
    // Comando /start
    if (text === '/start') {
      await sendMessage(chatId,
        '👋 *¡Hola! Soy tu bot de gastos.*\n\n' +
        '📝 *Registrar gasto* (enviá un mensaje):\n' +
        '• _"Gasté 5000 en el super"_\n' +
        '• _"450 café starbucks"_\n' +
        '• _"1700 colectivo"_ — ¡sin "gasté"!\n\n' +
        '📊 _/resumen_ — Reporte del mes\n' +
        '🗑️ _/eliminar_ — Ver lista y elegir\n' +
        '   _"eliminar 5"_ — Eliminar el gasto #5\n' +
        '✏️ _/editar_ — Ver lista y elegir\n' +
        '   _"editar 5"_ — Editar el gasto #5'
      );
      return;
    }

    // Comando /resumen
    if (text === '/resumen') {
      await sendTyping(chatId);
      const resumen = await getResumen(userId);
      await sendMessage(chatId, resumen);
      logger.info('/resumen ejecutado', { chatId, userId, latencyMs: Date.now() - startTime });
      return;
    }

    // Comando /eliminar
    if (text === '/eliminar') {
      await handleEliminarCommand(chatId, userId);
      logger.info('/eliminar ejecutado', { chatId, userId, latencyMs: Date.now() - startTime });
      return;
    }

    // Comando /editar
    if (text === '/editar') {
      await handleEditarCommand(chatId, userId);
      logger.info('/editar ejecutado', { chatId, userId, latencyMs: Date.now() - startTime });
      return;
    }

    // Texto: "eliminar gasto X" o "eliminar X"
    const deleteMatch = text.match(/^elimina?r?\s+(?:gasto\s+)?(\d+)$/i);
    if (deleteMatch) {
      const expenseId = parseInt(deleteMatch[1], 10);
      await handleDeleteById(chatId, userId, expenseId);
      logger.info('Eliminación por ID', { chatId, userId, expenseId, latencyMs: Date.now() - startTime });
      return;
    }

    // Texto: "editar gasto X" o "editar X"
    const editMatch = text.match(/^edita?r?\s+(?:gasto\s+)?(\d+)$/i);
    if (editMatch) {
      const expenseId = parseInt(editMatch[1], 10);
      await handleEditById(chatId, userId, expenseId);
      logger.info('Edición por ID', { chatId, userId, expenseId, latencyMs: Date.now() - startTime });
      return;
    }

    // Ignorar otros comandos
    if (text.startsWith('/')) {
      await sendMessage(chatId, '🤔 Comando no reconocido. Enviame un gasto (ej: "1700 colectivo") o usá /resumen.');
      return;
    }

    // ─── Check for active edit session ────────────────────────
    const handled = await handleEditInput(chatId, userId, text);
    if (handled) {
      logger.info('Input edit procesado', { chatId, userId, latencyMs: Date.now() - startTime });
      return;
    }

    // ─── Idempotencia ──────────────────────────────────────────
    const duplicate = await isDuplicate(userId, messageId);
    if (duplicate) {
      logger.info('Mensaje duplicado ignorado', { chatId, userId, messageId });
      return;
    }

    // ─── Typing indicator ──────────────────────────────────────
    await sendTyping(chatId);

    // ─── Parseo con IA ─────────────────────────────────────────
    const parsed = await parseExpense(text);

    if (parsed.error) {
      await sendMessage(chatId, parsed.error);
      logger.info('Parseo sin monto', { chatId, userId, messageId, error: parsed.error });
      return;
    }

    // ─── Guardar en Supabase ───────────────────────────────────
    const result = await saveExpense({
      telegramUserId: userId,
      chatId,
      messageId,
      monto: parsed.monto,
      categoria: parsed.categoria,
      descripcion: parsed.descripcion,
      establecimiento: parsed.establecimiento,
      rawMessage: text
    });

    if (!result.success) {
      await sendMessage(chatId, '❌ No pude guardar el registro. Reintentá.');
      return;
    }

    // ─── Total mensual ─────────────────────────────────────────
    const monthlyTotal = await getMonthlyTotal(userId);

    // ─── Respuesta de confirmación ─────────────────────────────
    let response = `✅ *Gasto registrado*\n\n`;
    response += `💸 *Monto*: $${formatNumber(parsed.monto)}\n`;
    response += `🏷️ *Categoría*: ${parsed.categoria}\n`;
    if (parsed.descripcion) {
      response += `📝 *Descripción*: ${parsed.descripcion}\n`;
    }
    if (parsed.establecimiento) {
      response += `🏪 *Establecimiento*: ${parsed.establecimiento}\n`;
    }
    response += `\n📅 *Total del mes*: $${formatNumber(monthlyTotal)}`;

    await sendMessage(chatId, response);

    logger.info('Gasto procesado OK', {
      chatId,
      userId,
      messageId,
      monto: parsed.monto,
      categoria: parsed.categoria,
      latencyMs: Date.now() - startTime
    });
  } catch (err) {
    logger.error('Error en handleMessage', {
      chatId,
      userId,
      messageId,
      error: err.message,
      stack: err.stack,
      latencyMs: Date.now() - startTime
    });

    try {
      await sendMessage(chatId, '⚠️ Problema técnico momentáneo. Reintentá en 30s.');
    } catch {
      // Silenciar si ni siquiera podemos responder
    }
  }
}

function formatNumber(num) {
  return num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ─── Iniciar servidor ─────────────────────────────────────────────
app.listen(config.port, async () => {
  logger.info(`Servidor iniciado en puerto ${config.port} (${config.nodeEnv})`);
  await setWebhook();
  startKeepAlive(app);
});

// ─── Session cleanup ──────────────────────────────────────────────
setInterval(() => {
  cleanupExpiredSessions();
}, 60 * 1000); // Cada minuto

// ─── Graceful shutdown ────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido. Cerrando...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { error: reason?.message || reason });
});
