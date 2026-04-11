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
 * @param {string|null} [params.receiptPhotoUrl]
 * @param {string|null} [params.receiptPhotoFileId]
 * @param {string|null} [params.ocrConfidence]
 * @param {string} [params.extractionMethod]
 * @param {string|null} [params.fechaRecibo]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveExpense({
  telegramUserId,
  chatId,
  messageId,
  monto,
  categoria,
  descripcion,
  establecimiento,
  rawMessage,
  receiptPhotoUrl = null,
  receiptPhotoFileId = null,
  ocrConfidence = null,
  extractionMethod = 'texto',
  fechaRecibo = null
}) {
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
      receipt_photo_url: receiptPhotoUrl,
      receipt_photo_file_id: receiptPhotoFileId,
      ocr_confidence: ocrConfidence,
      extraction_method: extractionMethod,
      fecha_recibo: fechaRecibo,
      created_at: new Date().toISOString()
    });

  if (error) {
    logger.error('Error guardando gasto', {
      telegramUserId, messageId,
      error: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      fullError: JSON.stringify(error)
    });
    return { success: false, error: error.message };
  }

  logger.info('Gasto guardado', { telegramUserId, messageId, monto, categoria, extractionMethod });
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

/**
 * Obtiene los últimos gastos de un usuario.
 * @param {number} telegramUserId
 * @param {number} [limit=10]
 * @returns {Promise<Array<{id: number, monto: number, categoria: string, descripcion: string|null, establecimiento: string|null, created_at: string}>>}
 */
export async function getRecentExpenses(telegramUserId, limit = 10) {
  const { data, error } = await supabase
    .from('gastos')
    .select('id, monto, categoria, descripcion, establecimiento, created_at')
    .eq('telegram_user_id', telegramUserId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Error obteniendo gastos recientes', { telegramUserId, error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Busca gastos con filtros inteligentes (usa keywords en descripción/establecimiento/categoría).
 * @param {number} telegramUserId
 * @param {object} filters
 * @param {string[]} [filters.keywords] - Palabras clave para buscar en descripción/establecimiento
 * @param {string} [filters.category] - Categoría exacta
 * @param {string} [filters.timeReference] - "hoy", "ayer", "esta semana", "este mes"
 * @param {boolean} [filters.isLast] - Si true, devuelve solo el más reciente
 * @param {number} [filters.expenseId] - ID explícito
 * @param {number} [limit=50]
 * @returns {Promise<Array<{id: number, monto: number, categoria: string, descripcion: string|null, establecimiento: string|null, created_at: string, matchScore?: number}>>}
 */
export async function searchExpenses(telegramUserId, filters, limit = 50) {
  let query = supabase
    .from('gastos')
    .select('id, monto, categoria, descripcion, establecimiento, created_at, raw_message')
    .eq('telegram_user_id', telegramUserId)
    .order('created_at', { ascending: false });

  // Filtro por ID explícito
  if (filters.expenseId) {
    query = query.eq('id', filters.expenseId);
  }

  // Filtro por categoría
  if (filters.category) {
    query = query.eq('categoria', filters.category);
  }

  // Filtro por keywords → push a Supabase con ilike (más eficiente que filtrar en memoria)
  if (filters.keywords && filters.keywords.length > 0) {
    const orParts = [];
    for (const keyword of filters.keywords) {
      orParts.push(`descripcion.ilike.%${keyword}%`);
      orParts.push(`establecimiento.ilike.%${keyword}%`);
      orParts.push(`raw_message.ilike.%${keyword}%`);
      orParts.push(`categoria.ilike.%${keyword}%`);
    }
    query = query.or(orParts.join(','));
  }

  // Filtro por tiempo
  if (filters.timeReference) {
    const now = new Date();
    let startDate;
    let endDate;

    switch (filters.timeReference.toLowerCase()) {
      case 'hoy':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        break;
      case 'ayer': {
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        startOfYesterday.setHours(0, 0, 0, 0);
        startDate = startOfYesterday.toISOString();
        const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endOfYesterday.setHours(0, 0, 0, 0);
        endDate = endOfYesterday.toISOString();
        break;
      }
      case 'esta semana': {
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek);
        startOfWeek.setHours(0, 0, 0, 0);
        startDate = startOfWeek.toISOString();
        break;
      }
      case 'este mes':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        break;
      default:
        startDate = null;
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lt('created_at', endDate);
    }
  }

  // Si es "último", limitamos a 1
  if (filters.isLast) {
    query = query.limit(1);
  } else {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Error buscando gastos', { telegramUserId, error: error.message });
    return [];
  }

  let results = data || [];

  // Ranking por relevancia (la DB ya filtró, esto solo ordena por score)
  if (filters.keywords && filters.keywords.length > 0) {
    results = results.map((expense) => {
      const searchableText = [
        expense.descripcion || '',
        expense.establecimiento || '',
        expense.raw_message || '',
        expense.categoria || ''
      ].join(' ').toLowerCase();
      const normalizedText = searchableText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      let score = 0;
      for (const keyword of filters.keywords) {
        const normalizedKeyword = keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        if (normalizedText.includes(normalizedKeyword)) {
          score += 1;
          if (normalizedText.startsWith(normalizedKeyword)) {
            score += 0.5;
          }
        }
      }

      return { ...expense, matchScore: score };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }

  return results;
}

/**
 * Elimina un gasto por ID (con verificación de propiedad).
 * @param {number} expenseId
 * @param {number} telegramUserId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteExpense(expenseId, telegramUserId) {
  const { error } = await supabase
    .from('gastos')
    .delete()
    .eq('id', expenseId)
    .eq('telegram_user_id', telegramUserId);

  if (error) {
    logger.error('Error eliminando gasto', { expenseId, telegramUserId, error: error.message });
    return { success: false, error: error.message };
  }

  logger.info('Gasto eliminado', { expenseId, telegramUserId });
  return { success: true };
}

/**
 * Actualiza campos de un gasto (con verificación de propiedad).
 * @param {number} expenseId
 * @param {number} telegramUserId
 * @param {object} updates - Campos a actualizar (monto, categoria, descripcion, establecimiento)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateExpense(expenseId, telegramUserId, updates) {
  const { error } = await supabase
    .from('gastos')
    .update(updates)
    .eq('id', expenseId)
    .eq('telegram_user_id', telegramUserId);

  if (error) {
    logger.error('Error actualizando gasto', { expenseId, telegramUserId, error: error.message });
    return { success: false, error: error.message };
  }

  logger.info('Gasto actualizado', { expenseId, telegramUserId, fields: Object.keys(updates) });
  return { success: true };
}

/**
 * Obtiene un gasto por ID verificando que pertenece al usuario.
 * @param {number} expenseId
 * @param {number} telegramUserId
 * @returns {Promise<object|null>}
 */
export async function getExpenseById(expenseId, telegramUserId) {
  const { data, error } = await supabase
    .from('gastos')
    .select('id, monto, categoria, descripcion, establecimiento, created_at')
    .eq('id', expenseId)
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Uploads receipt photo to Supabase Storage.
 * @param {Buffer} imageBuffer - Compressed image
 * @param {number} userId - Telegram user ID
 * @param {number} messageId - Telegram message ID
 * @returns {Promise<{url: string, path: string}>}
 */
export async function uploadReceipt(imageBuffer, userId, messageId) {
  try {
    const fileName = `${userId}/${messageId}_${Date.now()}.jpg`;
    const filePath = fileName;

    const { data, error } = await supabase.storage
      .from('receipt-photos')
      .upload(filePath, imageBuffer, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      logger.error('Supabase Storage upload error', {
        userId,
        messageId,
        error: error.message
      });
      throw error;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('receipt-photos')
      .getPublicUrl(filePath);

    logger.info('Receipt uploaded to Supabase Storage', {
      userId,
      messageId,
      filePath,
      url: urlData.publicUrl
    });

    return {
      url: urlData.publicUrl,
      path: filePath
    };
  } catch (err) {
    logger.error('Error uploading receipt', { userId, messageId, error: err.message });
    throw err;
  }
}
