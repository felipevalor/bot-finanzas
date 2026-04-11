// index.js — Entry point
import express from 'express';
import config from './src/config/env.js';
import logger from './src/utils/logger.js';
import { sendTyping, sendMessage, setWebhook, answerCallbackQuery, downloadFile } from './src/services/telegram.js';
import { parseExpense } from './src/services/parser.js';
import { isDuplicate, saveExpense, getMonthlyTotal, uploadReceipt } from './src/services/storage.js';
import { getResumen } from './src/services/resumen.js';
import supabase from './src/config/supabase.js';
import groq from './src/config/groq.js';
import { detectIntent } from './src/services/intentDetector.js';
import { parseReceiptPhoto } from './src/services/receiptParser.js';
import { compressImage, getLargestPhoto } from './src/utils/imageProcessor.js';
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
  handleEditById,
  handleDeleteByDescription,
  handleEditByDescription
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

  // Handle text messages
  if (!message.text) {
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

// ─── Handler para fotos de recibos ──────────────────────────────────────
async function handlePhotoMessage({ chatId, userId, messageId, photos, caption }) {
  const startTime = Date.now();

  try {
    // Typing indicator
    await sendTyping(chatId);

    // Get largest photo (best quality for OCR)
    const largestPhoto = getLargestPhoto(photos);
    const fileId = largestPhoto.file_id;

    logger.info('Processing receipt photo', { userId, fileId, fileSize: largestPhoto.file_size });

    // Download image from Telegram
    const imageBuffer = await downloadFile(fileId);

    // Compress image if needed (max 3.5MB for Groq API)
    const compressedImage = await compressImage(imageBuffer, 3.5);

    // Free memory
    imageBuffer.length = 0;

    // OCR with Groq Vision
    const parsed = await parseReceiptPhoto(compressedImage);

    // Log the full parsed response for debugging
    logger.info('OCR result', {
      userId,
      messageId,
      parsed: JSON.stringify(parsed),
      hasError: !!parsed.error,
      hasMonto: parsed.monto !== null && parsed.monto !== undefined
    });

    if (parsed.error || parsed.monto === null || parsed.monto === undefined) {
      const errorMsg = parsed.error || 'No se detectó un monto válido';
      logger.info('OCR failed or returned invalid data', { userId, messageId, error: errorMsg });
      await sendMessage(chatId,
        '⚠️ No pude leer claramente el recibo.\n\n' +
        'Posibles causas:\n' +
        '• La foto está borrosa o muy oscura\n' +
        '• El recibo está cortado\n' +
        '• Hay mucho reflejo o sombra\n\n' +
        'Intentá:\n' +
        '1️⃣ Otra foto con mejor iluminación\n' +
        '2️⃣ Enviarme los datos: "5000 cena restaurante"'
      );
      return;
    }

    // Upload to Supabase Storage
    let uploadResult = null;
    try {
      uploadResult = await uploadReceipt(compressedImage, userId, messageId);
    } catch (err) {
      logger.error('Failed to upload receipt photo, continuing without it', {
        userId,
        messageId,
        error: err.message
      });
      // Continue saving expense without photo URL
    }

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
      receiptPhotoUrl: uploadResult?.url || null,
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

    // Free memory
    compressedImage.length = 0;
  } catch (err) {
    logger.error('Error processing receipt photo', {
      chatId,
      userId,
      messageId,
      error: err.message,
      stack: err.stack,
      latencyMs: Date.now() - startTime
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

// ─── Handler principal ───────────────────────────────────────────
async function handleMessage({ chatId, userId, messageId, text }) {
  const startTime = Date.now();

  try {
    // Comando /start
    if (text === '/start') {
      await sendMessage(chatId,
        '👋 *¡Hola! Soy tu bot de gastos.*\n\n' +
        '📝 *Registrar gasto* (elegí una opción):\n\n' +
        '💬 *Por texto:*\n' +
        '• _"Gasté 5000 en el super"_\n' +
        '• _"450 café starbucks"_\n' +
        '• _"1700 colectivo"_ — ¡sin "gasté"!\n\n' +
        '📷 *Por foto:*\n' +
        '• Enviame una foto del recibo\n\n' +
        '📊 _/resumen_ — Reporte del mes\n' +
        '🗑️ _/eliminar_ — Ver lista y elegir\n' +
        '   _"elimina 5"_ — Eliminar el gasto #5\n' +
        '   _"elimina el gasto de colectivo"_ — Por descripción\n' +
        '   _"elimina lo del uber de ayer"_ — Con fecha\n' +
        '✏️ _/editar_ — Ver lista y elegir\n' +
        '   _"editá 5"_ — Editar el gasto #5\n' +
        '   _"editá el gasto del super"_ — Por descripción\n' +
        '   _"cambiá lo del colectivo a 2000"_ — Editar monto'
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

    // ─── Intent Detection para lenguaje natural ─────────────────────
    const intent = await detectIntent(text);

    if (intent.intention === 'summary') {
      await sendTyping(chatId);
      const resumen = await getResumen(userId);
      await sendMessage(chatId, resumen);
      logger.info('Intent: summary (lenguaje natural)', { chatId, userId, latencyMs: Date.now() - startTime });
      return;
    }

    if (intent.intention === 'delete') {
      await sendTyping(chatId);

      // Si hay ID explícito, usar delete by ID
      if (intent.expenseId) {
        await handleDeleteById(chatId, userId, intent.expenseId);
      } else if (intent.isLast) {
        // Eliminar el último gasto
        const recentExpenses = await (await import('./src/services/storage.js')).getRecentExpenses(userId, 1);
        if (recentExpenses.length === 0) {
          await sendMessage(chatId, 'No tenés gastos registrados.');
        } else {
          const lastExpense = recentExpenses[0];
          await handleDeleteById(chatId, userId, lastExpense.id);
        }
      } else {
        // Buscar por keywords y eliminar
        await handleDeleteByDescription(chatId, userId, intent);
      }
      logger.info('Intent: delete (lenguaje natural)', { chatId, userId, intent, latencyMs: Date.now() - startTime });
      return;
    }

    if (intent.intention === 'edit') {
      await sendTyping(chatId);

      // Si hay ID explícito, usar edit by ID
      if (intent.expenseId) {
        await handleEditById(chatId, userId, intent.expenseId);
      } else {
        // Buscar por keywords y editar
        await handleEditByDescription(chatId, userId, intent);
      }
      logger.info('Intent: edit (lenguaje natural)', { chatId, userId, intent, latencyMs: Date.now() - startTime });
      return;
    }

    // Si la intención es "create" u "other", continuar al parseo de gastos normal

    // Texto: "eliminar gasto X" o "eliminar X" o "elimina el gasto de colectivo"
    const deleteMatch = text.match(/^elimina?r?\s+(?:gasto\s+)?(\d+)$/i);
    if (deleteMatch) {
      const expenseId = parseInt(deleteMatch[1], 10);
      await handleDeleteById(chatId, userId, expenseId);
      logger.info('Eliminación por ID', { chatId, userId, expenseId, latencyMs: Date.now() - startTime });
      return;
    }

    // Detectar intención de eliminar/editar por descripción con IA
    if (/^elimina?r?\s+/i.test(text) || /^edita?r?\s+/i.test(text) || /^borra?r?\s+/i.test(text) || /^saca?r?\s+/i.test(text) || /^cambia?r?\s+/i.test(text)) {
      const intent = await detectIntent(text);
      
      if (intent.intention === 'delete') {
        await handleDeleteByDescription(chatId, userId, intent);
        logger.info('Eliminación por descripción (IA)', { chatId, userId, intent, latencyMs: Date.now() - startTime });
        return;
      }
      
      if (intent.intention === 'edit') {
        await handleEditByDescription(chatId, userId, intent);
        logger.info('Edición por descripción (IA)', { chatId, userId, intent, latencyMs: Date.now() - startTime });
        return;
      }

      // Si la IA detectó "create" pero el usuario empezó con "elimina", probablemente no hay monto válido
      if (intent.intention === 'create') {
        await sendMessage(chatId, '⚠️ No entendí qué gasto querés eliminar. Probá con:\n• _"elimina el gasto de colectivo"_\n• _"elimina lo del uber de ayer"_\n• _"elimina el último de alimentos"_');
        logger.info('Confusión en eliminación', { chatId, userId, text, intent, latencyMs: Date.now() - startTime });
        return;
      }
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

    // ─── Check for active edit session (BEFORE intent detection) ────────────────────────
    const handled = await handleEditInput(chatId, userId, text);
    if (handled) {
      logger.info('Input edit procesado', { chatId, userId, latencyMs: Date.now() - startTime });
      return;
    }

    // ─── Detect intention to delete/edit by description with AI ─────────────────────
    if (/^elimina?r?\s+/i.test(text) || /^edita?r?\s+/i.test(text) || /^borra?r?\s+/i.test(text) || /^saca?r?\s+/i.test(text) || /^cambia?r?\s+/i.test(text)) {
      const intent = await detectIntent(text);

      if (intent.intention === 'delete') {
        await handleDeleteByDescription(chatId, userId, intent);
        logger.info('Eliminación por descripción (IA)', { chatId, userId, intent, latencyMs: Date.now() - startTime });
        return;
      }

      if (intent.intention === 'edit') {
        await handleEditByDescription(chatId, userId, intent);
        logger.info('Edición por descripción (IA)', { chatId, userId, intent, latencyMs: Date.now() - startTime });
        return;
      }

      // If AI detected "create" but user started with "elimina", probably no valid amount
      if (intent.intention === 'create') {
        await sendMessage(chatId, '⚠️ No entendí qué gasto querés eliminar. Probá con:\n• _"elimina el gasto de colectivo"_\n• _"elimina lo del uber de ayer"_\n• _"elimina el último de alimentos"_');
        logger.info('Confusión en eliminación', { chatId, userId, text, intent, latencyMs: Date.now() - startTime });
        return;
      }

      // Handle rate limit or other AI errors
      if (intent.intention === 'error') {
        await sendMessage(chatId, '⚠️ Servicio ocupado. Reintentá en un momento.');
        return;
      }
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
