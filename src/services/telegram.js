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
 * Registra el webhook en Telegram.
 */
export async function setWebhook() {
  const url = config.telegram.webhookUrl;
  try {
    const res = await fetch(`${API_BASE}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message'] })
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
