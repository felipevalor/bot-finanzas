// src/services/storage.js
import supabase from '../config/supabase.js';
import logger from '../utils/logger.js';

/**
 * Verifica si un mensaje ya fue procesado (idempotencia).
 * @param {number} telegramUserId
 * @param {number} messageId
 * @returns {Promise<boolean>}
 */
export async function isDuplicate(telegramUserId, messageId) {
  const { data, error } = await supabase
    .from('gastos')
    .select('id')
    .eq('telegram_user_id', telegramUserId)
    .eq('telegram_message_id', messageId)
    .limit(1);

  if (error) {
    logger.error('Error verificando duplicado', { telegramUserId, messageId, error: error.message });
    return false; // Ante la duda, procesar
  }

  return data && data.length > 0;
}

/**
 * Guarda un gasto en Supabase.
 * @param {object} params
 * @param {number} params.telegramUserId
 * @param {number} params.chatId
 * @param {number} params.messageId
 * @param {number} params.monto
 * @param {string} params.categoria
 * @param {string|null} params.descripcion
 * @param {string|null} params.establecimiento
 * @param {string} params.rawMessage
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveExpense({ telegramUserId, chatId, messageId, monto, categoria, descripcion, establecimiento, rawMessage }) {
  const { error } = await supabase
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
      created_at: new Date().toISOString()
    });

  if (error) {
    logger.error('Error guardando gasto', { telegramUserId, messageId, error: error.message });
    return { success: false, error: error.message };
  }

  logger.info('Gasto guardado', { telegramUserId, messageId, monto, categoria });
  return { success: true };
}

/**
 * Obtiene el total gastado en el mes actual para un usuario.
 * @param {number} telegramUserId
 * @returns {Promise<number>}
 */
export async function getMonthlyTotal(telegramUserId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data, error } = await supabase
    .from('gastos')
    .select('monto')
    .eq('telegram_user_id', telegramUserId)
    .gte('created_at', startOfMonth);

  if (error) {
    logger.error('Error obteniendo total mensual', { telegramUserId, error: error.message });
    return 0;
  }

  return data.reduce((sum, row) => sum + (row.monto || 0), 0);
}
