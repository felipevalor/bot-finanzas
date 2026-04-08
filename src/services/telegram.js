// src/services/telegram.js
import logger from '../utils/logger.js';
import config from '../config/env.js';

const API_BASE = `https://api.telegram.org/bot${config.telegram.token}`;

/**
 * Envía typing indicator al chat.
 */
export async function sendTyping(chatId) {
  try {
    await fetch(`${API_BASE}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' })
    });
  } catch (err) {
    logger.error('Error enviando typing', { chatId, error: err.message });
  }
}

/**
 * Envía mensaje de texto con Markdown.
 */
export async function sendMessage(chatId, text) {
  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });

    if (!res.ok) {
      // Reintentar sin Markdown si falla el parseo
      const body = await res.json();
      if (body?.description?.includes('parse')) {
        await fetch(`${API_BASE}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text })
        });
      } else {
        logger.error('Error sendMessage', { chatId, status: res.status, body });
      }
    }
  } catch (err) {
    logger.error('Error sendMessage', { chatId, error: err.message });
  }
}

/**
 * Envía un mensaje con botones inline (inline keyboard).
 * @param {number} chatId
 * @param {string} text - Texto en formato Markdown
 * @param {Array<Array<{text: string, callback_data: string}>>} inlineKeyboard - Matriz de botones
 * @returns {Promise<{message_id: number}|null>} - Objeto de mensaje o null si falla
 */
export async function sendInlineMessage(chatId, text, inlineKeyboard) {
  try {
    const response = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      })
    });

    const data = await response.json();

    if (!data.ok) {
      logger.error('Error enviando inline message', { chatId, error: data.description });
      return null;
    }

    return { message_id: data.result.message_id };
  } catch (err) {
    logger.error('Error en sendInlineMessage', { chatId, error: err.message });
    return null;
  }
}

/**
 * Edita el texto y/o teclado de un mensaje existente.
 * @param {number} chatId
 * @param {number} messageId
 * @param {string} newText - Nuevo texto en Markdown
 * @param {Array<Array<{text: string, callback_data: string}>>} [newKeyboard] - Nuevo teclado (opcional)
 * @returns {Promise<boolean>}
 */
export async function editMessageText(chatId, messageId, newText, newKeyboard) {
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'Markdown'
    };

    if (newKeyboard) {
      payload.reply_markup = { inline_keyboard: newKeyboard };
    }

    const response = await fetch(`${API_BASE}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.ok) {
      logger.error('Error editando mensaje', { chatId, messageId, error: data.description });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Error en editMessageText', { chatId, messageId, error: err.message });
    return false;
  }
}

/**
 * Responde a un callback query (requerido para detener el spinner de Telegram).
 * DEBE ser llamado para CADA callback dentro de los 30 segundos.
 * @param {string} callbackQueryId
 * @param {string} [text] - Texto opcional a mostrar
 * @param {boolean} [showAlert=false] - Si true, muestra popup en vez de notificación
 * @returns {Promise<boolean>}
 */
export async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  try {
    const payload = { callback_query_id: callbackQueryId };

    if (text) {
      payload.text = text;
      payload.show_alert = showAlert;
    }

    const response = await fetch(`${API_BASE}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.ok) {
      logger.error('Error respondiendo callback', { callbackQueryId, error: data.description });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('Error en answerCallbackQuery', { callbackQueryId, error: err.message });
    return false;
  }
}

/**
 * Registra el webhook en Telegram.
 */
export async function setWebhook() {
  const url = config.telegram.webhookUrl;
  try {
    const res = await fetch(`${API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message', 'callback_query'] })
    });
    const data = await res.json();
    if (data.ok) {
      logger.info(`Webhook registrado: ${url}`);
    } else {
      logger.error('Error registrando webhook', { data });
    }
  } catch (err) {
    logger.error('Error registrando webhook', { error: err.message });
  }
}
