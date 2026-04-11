// src/services/expenseManager.js
import { getRecentExpenses, getExpenseById, deleteExpense, updateExpense, searchExpenses } from './storage.js';
import { sendInlineMessage, editMessageText, answerCallbackQuery, sendMessage } from './telegram.js';
import logger from '../utils/logger.js';
import config from '../config/env.js';
import { formatNumber, formatDate } from '../utils/format.js';

// ─── Session Management ──────────────────────────────────────────
const editSessions = new Map();

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Creates or updates an edit session for a user.
 */
export function createSession(userId, action, expenseId, chatId, messageId) {
  editSessions.set(userId, {
    action,
    expenseId,
    chatId,
    messageId,
    createdAt: Date.now()
  });
}

/**
 * Updates session with field being edited.
 */
export function setSessionField(userId, field) {
  const session = editSessions.get(userId);
  if (session) {
    session.field = field;
  }
}

/**
 * Gets a user's session.
 */
export function getSession(userId) {
  return editSessions.get(userId);
}

/**
 * Clears a user's session.
 */
export function clearSession(userId) {
  editSessions.delete(userId);
}

/**
 * Checks if a session is expired.
 */
export function isSessionExpired(userId) {
  const session = editSessions.get(userId);
  if (!session) return true;
  return Date.now() - session.createdAt > SESSION_TIMEOUT_MS;
}

/**
 * Cleans up all expired sessions.
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [userId, session] of editSessions.entries()) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS) {
      editSessions.delete(userId);
    }
  }
}

// ─── Inline Keyboard Builders ────────────────────────────────────

/**
 * Builds expense selection keyboard (used by both /eliminar and /editar).
 */
export function buildExpenseKeyboard(expenses, action) {
  const buttons = expenses.map((expense) => {
    const emoji = getExpenseEmoji(expense.categoria);
    const text = `${emoji} $${formatNumber(expense.monto)} - ${expense.descripcion || expense.establecimiento || 'Sin descripción'} (${expense.categoria})`;
    const callbackData = action === 'delete' ? `del:${expense.id}` : `edit:${expense.id}`;
    return [{ text, callback_data: callbackData }];
  });

  // Cancel button
  buttons.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);

  return buttons;
}

/**
 * Builds field selection keyboard for editing.
 */
export function buildFieldKeyboard() {
  return [
    [{ text: '💰 Monto', callback_data: 'field:monto' }, { text: '🏷️ Categoría', callback_data: 'field:categoria' }],
    [{ text: '📝 Descripción', callback_data: 'field:descripcion' }, { text: '🏪 Establecimiento', callback_data: 'field:establecimiento' }],
    [{ text: '❌ Cancelar', callback_data: 'cancel' }]
  ];
}

/**
 * Builds category selection keyboard.
 */
export function buildCategoryKeyboard(categories) {
  const categoryEmojis = {
    Alimentos: '🍔',
    Transporte: '🚗',
    Hogar: '🏠',
    Salud: '💊',
    Educación: '📚',
    Ocio: '🎮',
    Ropa: '👕',
    Tecnología: '💻',
    Servicios: '📋',
    Facturas: '📄',
    Salidas: '🍻',
    Otros: '📦'
  };

  // 4 categories per row
  const rows = [];
  for (let i = 0; i < categories.length; i += 4) {
    const row = categories.slice(i, i + 4).map((cat) => ({
      text: `${categoryEmojis[cat] || '📦'} ${cat}`,
      callback_data: `cat:${cat}`
    }));
    rows.push(row);
  }

  // Cancel button
  rows.push([{ text: '❌ Cancelar', callback_data: 'cancel' }]);

  return rows;
}

/**
 * Builds confirmation keyboard for delete.
 */
export function buildConfirmKeyboard() {
  return [
    [{ text: '✅ Confirmar eliminación', callback_data: 'confirm:yes' }],
    [{ text: '❌ Cancelar', callback_data: 'confirm:no' }]
  ];
}

// ─── Shared Search Helper ────────────────────────────────────────────

/**
 * Shared search logic for delete/edit by description.
 * Returns { found: 0|1|'multiple', expenses: [], filters: {} }
 */
async function searchAndBranch(userId, intent, limit = 10) {
  const filters = {
    keywords: intent.searchKeywords || [],
    category: intent.category || null,
    timeReference: intent.timeReference || null,
    isLast: intent.isLast || false,
    expenseId: intent.expenseId || null
  };

  const expenses = await searchExpenses(userId, filters, limit);
  return { found: expenses.length === 0 ? 0 : expenses.length === 1 ? 1 : 'multiple', expenses, filters };
}

/**
 * Apply a single field update and respond.
 */
async function applyFieldUpdate(chatId, userId, expenseId, field, value) {
  const result = await updateExpense(expenseId, userId, { [field]: value });

  const fieldNames = {
    monto: 'Monto',
    categoria: 'Categoría',
    descripcion: 'Descripción',
    establecimiento: 'Establecimiento'
  };

  if (result.success) {
    const displayValue = field === 'monto' ? `$${formatNumber(value)}` : value;
    await sendMessage(chatId, `✅ ${fieldNames[field]} actualizado: ${displayValue}`);
    logger.info(`${fieldNames[field]} editado por descripción`, { userId, expenseId, newValue: value });
  } else {
    await sendMessage(chatId, `❌ No pude actualizar el/la ${fieldNames[field].toLowerCase()}. Reintentá.`);
  }
}

// ─── Command Handlers ────────────────────────────────────────────

/**
 * Handles /eliminar command.
 */
export async function handleEliminarCommand(chatId, userId) {
  const expenses = await getRecentExpenses(userId, 10);

  if (expenses.length === 0) {
    await sendMessage(chatId, 'No tenés gastos recientes. ¡Empezá registrando uno!');
    return;
  }

  const keyboard = buildExpenseKeyboard(expenses, 'delete');
  const text = '🗑️ *¿Qué gasto querés eliminar?*\n\nSeleccioná uno:';

  await sendInlineMessage(chatId, text, keyboard);
}

/**
 * Handles /editar command.
 */
export async function handleEditarCommand(chatId, userId) {
  const expenses = await getRecentExpenses(userId, 10);

  if (expenses.length === 0) {
    await sendMessage(chatId, 'No tenés gastos recientes. ¡Empezá registrando uno!');
    return;
  }

  const keyboard = buildExpenseKeyboard(expenses, 'edit');
  const text = '✏️ *¿Qué gasto querés editar?*\n\nSeleccioná uno:';

  await sendInlineMessage(chatId, text, keyboard);
}

/**
 * Handles "eliminar X" text command (direct delete by ID, no confirmation).
 */
export async function handleDeleteById(chatId, userId, expenseId) {
  const expense = await getExpenseById(expenseId, userId);

  if (!expense) {
    await sendMessage(chatId, `❌ No encontré el gasto #${expenseId}. Usá /eliminar para ver tus gastos recientes.`);
    return;
  }

  const result = await deleteExpense(expenseId, userId);

  if (result.success) {
    let response = `✅ Gasto #${expenseId} eliminado\n\n`;
    response += `💰 Monto: $${formatNumber(expense.monto)}\n`;
    response += `🏷️ Categoría: ${expense.categoria}\n`;
    if (expense.descripcion) {
      response += `📝 Descripción: ${expense.descripcion}\n`;
    }
    await sendMessage(chatId, response);
    logger.info('Gasto eliminado por ID', { userId, expenseId });
  } else {
    await sendMessage(chatId, '❌ No pude eliminar el gasto. Reintentá.');
    logger.error('Error eliminando gasto por ID', { userId, expenseId, error: result.error });
  }
}

/**
 * Handles "editar X" text command (starts edit session for the expense).
 */
export async function handleEditById(chatId, userId, expenseId) {
  const expense = await getExpenseById(expenseId, userId);

  if (!expense) {
    await sendMessage(chatId, `❌ No encontré el gasto #${expenseId}. Usá /editar para ver tus gastos recientes.`);
    return;
  }

  // Create edit session
  createSession(userId, 'edit', expenseId, chatId, null);

  let text = `✏️ Editando gasto #${expenseId}:\n\n`;
  text += `💰 *Monto*: $${formatNumber(expense.monto)}\n`;
  text += `🏷️ *Categoría*: ${expense.categoria}\n`;
  if (expense.descripcion) {
    text += `📝 *Descripción*: ${expense.descripcion}\n`;
  }
  if (expense.establecimiento) {
    text += `🏪 *Establecimiento*: ${expense.establecimiento}\n`;
  }
  text += `📅 *Fecha*: ${formatDate(expense.created_at)}\n\n`;
  text += `¿Qué campo querés modificar?\n`;
  text += `• _"monto 2500"_ — nuevo monto\n`;
  text += `• _"categoría Alimentos"_ — nueva categoría\n`;
  text += `• _"desc compra semanal"_ — nueva descripción\n`;
  text += `• _"establecimiento Día"_ — nuevo establecimiento`;

  await sendMessage(chatId, text);
}

/**
 * Handles AI-powered delete by description (e.g. "elimina el gasto de colectivo").
 */
export async function handleDeleteByDescription(chatId, userId, intent) {
  const { found, expenses, filters } = await searchAndBranch(userId, intent, 10);

  if (found === 0) {
    await sendMessage(chatId, '❌ No encontré gastos que coincidan con tu búsqueda.\n\n💡 Probá con otros términos, por ejemplo:\n• _"elimina el gasto de colectivo"_\n• _"elimina lo del uber de ayer"_\n• _"elimina el último de alimentos"_');
    return;
  }

  if (found === 1) {
    const expense = expenses[0];
    const result = await deleteExpense(expense.id, userId);

    if (result.success) {
      let response = `✅ Gasto eliminado:\n\n`;
      response += `💰 Monto: $${formatNumber(expense.monto)}\n`;
      response += `🏷️ Categoría: ${expense.categoria}\n`;
      if (expense.descripcion) {
        response += `📝 Descripción: ${expense.descripcion}\n`;
      }
      if (expense.establecimiento) {
        response += `🏪 Establecimiento: ${expense.establecimiento}\n`;
      }
      await sendMessage(chatId, response);
      logger.info('Gasto eliminado por descripción', { userId, expenseId: expense.id, filters });
    } else {
      await sendMessage(chatId, '❌ No pude eliminar el gasto. Reintentá.');
      logger.error('Error eliminando gasto por descripción', { userId, expenseId: expense.id, error: result.error });
    }
  } else {
    const keyboard = buildExpenseKeyboard(expenses, 'delete');
    const text = `Encontré ${expenses.length} gastos que coinciden. ¿Cuál querés eliminar?\n\nSeleccioná uno:`;

    await sendInlineMessage(chatId, text, keyboard);
    logger.info('Múltiples gastos encontrados para eliminación', { userId, count: expenses.length, filters });
  }
}

/**
 * Handles AI-powered edit by description (e.g. "editá el gasto del super").
 */
export async function handleEditByDescription(chatId, userId, intent) {
  const { found, expenses, filters } = await searchAndBranch(userId, intent, 10);

  if (found === 0) {
    await sendMessage(chatId, '❌ No encontré gastos que coincidan con tu búsqueda.\n\n💡 Probá con otros términos, por ejemplo:\n• _"editá el gasto del super"_\n• _"cambiá lo del colectivo de ayer"_\n• _"editá el último de alimentos"_');
    return;
  }

  if (found === 1) {
    const expense = expenses[0];
    createSession(userId, 'edit', expense.id, chatId, null);

    // Check if user specified what to update
    if (intent.updates) {
      const updates = intent.updates;

      if (updates.monto) {
        await applyFieldUpdate(chatId, userId, expense.id, 'monto', updates.monto);
        return;
      }
      if (updates.categoria) {
        await applyFieldUpdate(chatId, userId, expense.id, 'categoria', updates.categoria);
        return;
      }
      if (updates.descripcion) {
        await applyFieldUpdate(chatId, userId, expense.id, 'descripcion', updates.descripcion);
        return;
      }
      if (updates.establecimiento) {
        await applyFieldUpdate(chatId, userId, expense.id, 'establecimiento', updates.establecimiento);
        return;
      }
    }

    // No specific updates — show field selection
    let text = `✏️ Editando gasto:\n\n`;
    text += `💰 *Monto*: $${formatNumber(expense.monto)}\n`;
    text += `🏷️ *Categoría*: ${expense.categoria}\n`;
    if (expense.descripcion) {
      text += `📝 *Descripción*: ${expense.descripcion}\n`;
    }
    if (expense.establecimiento) {
      text += `🏪 *Establecimiento*: ${expense.establecimiento}\n`;
    }
    text += `📅 *Fecha*: ${formatDate(expense.created_at)}\n\n`;
    text += `¿Qué campo querés modificar?\n`;
    text += `• _"monto 2500"_ — nuevo monto\n`;
    text += `• _"categoría Alimentos"_ — nueva categoría\n`;
    text += `• _"desc compra semanal"_ — nueva descripción\n`;
    text += `• _"establecimiento Día"_ — nuevo establecimiento`;

    await sendMessage(chatId, text);
  } else {
    const keyboard = buildExpenseKeyboard(expenses, 'edit');
    const text = `Encontré ${expenses.length} gastos que coinciden. ¿Cuál querés editar?\n\nSeleccioná uno:`;

    await sendInlineMessage(chatId, text, keyboard);
    logger.info('Múltiples gastos encontrados para edición', { userId, count: expenses.length, filters });
  }
}

// ─── Callback Handlers ───────────────────────────────────────────

/**
 * Handles expense selection for delete.
 */
export async function handleDeleteSelection(query, userId) {
  const callbackId = query.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const expenseId = parseInt(query.data.split(':')[1], 10);

  const expense = await getExpenseById(expenseId, userId);

  if (!expense) {
    await answerCallbackQuery(callbackId, '❌ Este gasto ya no existe', true);
    return;
  }

  // Create session
  createSession(userId, 'delete', expenseId, chatId, messageId);

  // Build confirmation message
  const text = `¿Eliminar este gasto?\n\n` +
    `💰 *Monto*: $${formatNumber(expense.monto)}\n` +
    `🏷️ *Categoría*: ${expense.categoria}\n` +
    `${expense.descripcion ? `📝 *Descripción*: ${expense.descripcion}\n` : ''}` +
    `${expense.establecimiento ? `🏪 *Establecimiento*: ${expense.establecimiento}\n` : ''}` +
    `📅 *Fecha*: ${formatDate(expense.created_at)}`;

  const keyboard = buildConfirmKeyboard();

  await editMessageText(chatId, messageId, text, keyboard);
  await answerCallbackQuery(callbackId);
}

/**
 * Handles expense selection for edit.
 */
export async function handleEditSelection(query, userId) {
  const callbackId = query.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const expenseId = parseInt(query.data.split(':')[1], 10);

  const expense = await getExpenseById(expenseId, userId);

  if (!expense) {
    await answerCallbackQuery(callbackId, '❌ Este gasto ya no existe', true);
    return;
  }

  // Create session
  createSession(userId, 'edit', expenseId, chatId, messageId);

  // Build field selection message
  const text = `Editando gasto:\n\n` +
    `💰 *Monto*: $${formatNumber(expense.monto)}\n` +
    `🏷️ *Categoría*: ${expense.categoria}\n` +
    `${expense.descripcion ? `📝 *Descripción*: ${expense.descripcion}\n` : ''}` +
    `${expense.establecimiento ? `🏪 *Establecimiento*: ${expense.establecimiento}\n` : ''}` +
    `📅 *Fecha*: ${formatDate(expense.created_at)}\n\n` +
    `¿Qué campo querés modificar?`;

  const keyboard = buildFieldKeyboard();

  await editMessageText(chatId, messageId, text, keyboard);
  await answerCallbackQuery(callbackId);
}

/**
 * Handles delete confirmation.
 */
export async function handleConfirmDelete(query, userId) {
  const callbackId = query.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const session = getSession(userId);

  if (!session || session.action !== 'delete') {
    await answerCallbackQuery(callbackId, '⏰ Sesión expirada', true);
    return;
  }

  // Clear session BEFORE operation
  clearSession(userId);

  const result = await deleteExpense(session.expenseId, userId);

  if (result.success) {
    await editMessageText(chatId, messageId, '✅ Gasto eliminado correctamente.');
    logger.info('Gasto eliminado vía /eliminar', { userId, expenseId: session.expenseId });
  } else {
    await editMessageText(chatId, messageId, '❌ No pude eliminar el gasto. Reintentá.');
    logger.error('Error eliminando gasto vía /eliminar', { userId, error: result.error });
  }

  await answerCallbackQuery(callbackId);
}

/**
 * Handles cancel action.
 */
export async function handleCancel(query, userId) {
  const callbackId = query.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // Clear session
  clearSession(userId);

  await editMessageText(chatId, messageId, '❌ Operación cancelada.');
  await answerCallbackQuery(callbackId);
}

/**
 * Handles field selection for editing.
 */
export async function handleFieldSelection(query, userId, field) {
  const callbackId = query.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const session = getSession(userId);

  if (!session || session.action !== 'edit') {
    await answerCallbackQuery(callbackId, '⏰ Sesión expirada', true);
    return;
  }

  if (field === 'categoria') {
    // Show category keyboard
    const keyboard = buildCategoryKeyboard(config.allowedCategories);

    await editMessageText(chatId, messageId, '🏷️ *Seleccioná la nueva categoría:*', keyboard);
    await answerCallbackQuery(callbackId);
  } else {
    // For other fields, set field in session and prompt for input
    setSessionField(userId, field);

    const prompts = {
      monto: '💰 Envíame el nuevo monto:',
      descripcion: '📝 Envíame la nueva descripción:',
      establecimiento: '🏪 Envíame el nuevo establecimiento:'
    };

    await editMessageText(chatId, messageId, prompts[field] || 'Envíame el nuevo valor:');
    await answerCallbackQuery(callbackId);
  }
}

/**
 * Handles category selection.
 */
export async function handleCategorySelection(query, userId, category) {
  const callbackId = query.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const session = getSession(userId);

  if (!session || session.action !== 'edit') {
    await answerCallbackQuery(callbackId, '⏰ Sesión expirada', true);
    return;
  }

  // Clear session BEFORE operation
  clearSession(userId);

  const result = await updateExpense(session.expenseId, userId, { categoria: category });

  if (result.success) {
    await sendMessage(chatId, `✅ Categoría actualizada: ${category}`);
    logger.info('Categoría editada', { userId, expenseId: session.expenseId, newCategory: category });
  } else {
    await sendMessage(chatId, '❌ No pude actualizar la categoría. Reintentá.');
  }

  await answerCallbackQuery(callbackId);
}

/**
 * Handles text input during edit session (monto, descripcion, establecimiento, categoria).
 */
export async function handleEditInput(chatId, userId, text) {
  const session = getSession(userId);

  if (!session || session.action !== 'edit') {
    return false; // Not in edit mode
  }

  if (isSessionExpired(userId)) {
    clearSession(userId);
    await sendMessage(chatId, '⏰ Sesión expirada. Volvé a usar /editar');
    return true;
  }

  const { expenseId, field } = session;

  // If no field is set yet, try to parse the command (text-based edit flow)
  if (!field) {
    return await handleEditFieldCommand(chatId, userId, text, expenseId);
  }

  // Field is already set via inline keyboard — process the value
  if (field === 'monto') {
    const monto = parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));

    if (isNaN(monto) || monto <= 0) {
      await sendMessage(chatId, '⚠️ El monto debe ser un número mayor a 0');
      return true;
    }

    const result = await updateExpense(expenseId, userId, { monto });

    if (result.success) {
      await sendMessage(chatId, '✅ Monto actualizado correctamente');
      logger.info('Monto editado', { userId, expenseId, newMonto: monto });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar el monto. Reintentá.');
    }
  } else if (field === 'descripcion') {
    const result = await updateExpense(expenseId, userId, { descripcion: text });

    if (result.success) {
      await sendMessage(chatId, '✅ Descripción actualizada correctamente');
      logger.info('Descripción editada', { userId, expenseId });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar la descripción. Reintentá.');
    }
  } else if (field === 'establecimiento') {
    const result = await updateExpense(expenseId, userId, { establecimiento: text });

    if (result.success) {
      await sendMessage(chatId, '✅ Establecimiento actualizado correctamente');
      logger.info('Establecimiento editado', { userId, expenseId });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar el establecimiento. Reintentá.');
    }
  }

  // Clear session
  clearSession(userId);
  return true;
}

/**
 * Handles field command during edit session (e.g. "monto 2500", "categoría Alimentos").
 */
async function handleEditFieldCommand(chatId, userId, text, expenseId) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // "monto 2500"
  const montoMatch = text.match(/^(?:monto|monto\s+)?\$?\s*([\d.,]+)$/i);
  if (montoMatch || lower.startsWith('monto')) {
    let value;
    if (montoMatch) {
      value = montoMatch[1];
    } else {
      value = text.replace(/^monto\s+/i, '').trim();
    }
    const monto = parseFloat(value.replace(/[^0-9.,]/g, '').replace(',', '.'));

    if (isNaN(monto) || monto <= 0) {
      await sendMessage(chatId, '⚠️ El monto debe ser un número mayor a 0. Ej: "monto 2500"');
      return true;
    }

    const result = await updateExpense(expenseId, userId, { monto });
    if (result.success) {
      await sendMessage(chatId, `✅ Monto actualizado: $${formatNumber(monto)}`);
      logger.info('Monto editado', { userId, expenseId, newMonto: monto });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar el monto. Reintentá.');
    }
    clearSession(userId);
    return true;
  }

  // "categoría Alimentos"
  const catMatch = lower.match(/^(?:categoria)\s+(.+)$/);
  if (catMatch) {
    const categoryInput = catMatch[1].trim();
    const normalizedInput = categoryInput.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const match = config.allowedCategories.find((cat) =>
      cat.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalizedInput
    );

    if (!match) {
      await sendMessage(chatId, `⚠️ Categoría no reconocida: "${categoryInput}".\nCategorías válidas: ${config.allowedCategories.join(', ')}`);
      return true;
    }

    const result = await updateExpense(expenseId, userId, { categoria: match });
    if (result.success) {
      await sendMessage(chatId, `✅ Categoría actualizada: ${match}`);
      logger.info('Categoría editada', { userId, expenseId, newCategory: match });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar la categoría. Reintentá.');
    }
    clearSession(userId);
    return true;
  }

  // "desc ..." or "descripción ..."
  const descMatch = text.match(/^(?:desc(?:ripcion)?)\s+(.+)$/i);
  if (descMatch) {
    const result = await updateExpense(expenseId, userId, { descripcion: descMatch[1] });
    if (result.success) {
      await sendMessage(chatId, `✅ Descripción actualizada: ${descMatch[1]}`);
      logger.info('Descripción editada', { userId, expenseId });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar la descripción. Reintentá.');
    }
    clearSession(userId);
    return true;
  }

  // "establecimiento ..."
  const estMatch = text.match(/^(?:establecimiento|estab(?:lecimiento)?)\s+(.+)$/i);
  if (estMatch) {
    const result = await updateExpense(expenseId, userId, { establecimiento: estMatch[1] });
    if (result.success) {
      await sendMessage(chatId, `✅ Establecimiento actualizado: ${estMatch[1]}`);
      logger.info('Establecimiento editado', { userId, expenseId });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar el establecimiento. Reintentá.');
    }
    clearSession(userId);
    return true;
  }

  await sendMessage(chatId, '⚠️ No entendí qué campo querés editar. Usá:\n• _"monto 2500"_\n• _"categoría Alimentos"_\n• _"desc compra semanal"_\n• _"establecimiento Día"_');
  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────

function getExpenseEmoji(categoria) {
  const emojis = {
    Alimentos: '🍔',
    Transporte: '🚗',
    Hogar: '🏠',
    Salud: '💊',
    Educación: '📚',
    Ocio: '🎮',
    Ropa: '👕',
    Tecnología: '💻',
    Servicios: '📋',
    Facturas: '📄',
    Salidas: '🍻',
    Otros: '📦'
  };
  return emojis[categoria] || '💰';
}
