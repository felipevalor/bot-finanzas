// src/services/productQuery.js
import { getLastPrice } from './storage.js';
import { sendMessage } from './telegram.js';
import { formatNumber } from '../utils/format.js';
import logger from '../utils/logger.js';

const MAX_ITEMS_IN_LIST = 15;

/**
 * Formatea la fecha de un producto para mostrar al usuario.
 * @param {string} fechaStr - ISO date string
 * @returns {string}
 */
function formatFecha(fechaStr) {
  if (!fechaStr) return '';
  const d = new Date(fechaStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Maneja la intención price_check: busca el último precio de un producto y responde.
 * @param {number} chatId
 * @param {number} userId
 * @param {object} intent - Intent con productKeywords
 */
export async function handlePriceCheck(chatId, userId, intent) {
  const keywords = intent.productKeywords;

  if (!keywords || keywords.length === 0) {
    await sendMessage(chatId, '¿Qué producto querés consultar? Probá con:\n_"cuánto pagué por la leche?"_');
    return;
  }

  logger.info('Price check query', { chatId, userId, keywords });

  const result = await getLastPrice(userId, keywords);

  if (!result) {
    await sendMessage(
      chatId,
      `No encontré registros de ese producto.\n\nAsegurate de haber subido un recibo que lo incluya. 📷`
    );
    return;
  }

  const fecha = formatFecha(result.fecha);
  let msg = `🏷️ *Último precio registrado:*\n\n`;
  msg += `📦 *${result.nombre}*\n`;
  msg += `💸 $${formatNumber(result.precio)}`;
  if (result.cantidad && result.cantidad !== 1) {
    const unidad = result.unidad && result.unidad !== 'un' ? ` ${result.unidad}` : '';
    msg += ` (x${result.cantidad}${unidad})`;
  }
  msg += `\n`;
  if (result.establecimiento) {
    msg += `🏪 ${result.establecimiento}\n`;
  }
  if (fecha) {
    msg += `📅 ${fecha}`;
  }

  await sendMessage(chatId, msg);
}

/**
 * Formatea la lista de ítems de un recibo para mostrar al usuario.
 * @param {Array<{nombre: string, precio: number, cantidad: number, unidad: string|null}>} items
 * @returns {string} - Texto formateado, vacío si no hay items
 */
export function formatItemList(items) {
  if (!items || items.length === 0) return '';

  const total = items.length;
  const toShow = items.slice(0, MAX_ITEMS_IN_LIST);

  let list = `\n📋 *Detalle del recibo:*\n`;

  for (const item of toShow) {
    const precio = `$${formatNumber(item.precio)}`;
    let linea = `• ${item.nombre} — ${precio}`;

    if (item.cantidad && item.cantidad > 1) {
      const unidad = item.unidad && item.unidad !== 'un' ? item.unidad : '';
      linea += ` (x${item.cantidad}${unidad ? ' ' + unidad : ''})`;
    }

    list += linea + '\n';
  }

  if (total > MAX_ITEMS_IN_LIST) {
    list += `_... y ${total - MAX_ITEMS_IN_LIST} productos más_`;
  }

  return list;
}
