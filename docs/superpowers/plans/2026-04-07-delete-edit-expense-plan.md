# Delete & Edit Expense Commands — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eliminar` and `/editar` commands with Telegram inline keyboard buttons for interactive expense management.

**Architecture:** Callback-based inline button system with in-memory session tracking. Commands fetch recent expenses, display inline keyboards, and route user interactions via callback queries. Text input during edit sessions is intercepted and routed to field-specific handlers.

**Tech Stack:** Node.js ESM, Express, Supabase JS client, Telegram Bot API (inline keyboards, callback queries), native fetch

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/storage.js` | Modify | Add `getRecentExpenses`, `deleteExpense`, `updateExpense` |
| `src/services/telegram.js` | Modify | Add `sendInlineMessage`, `editMessageText`, `answerCallbackQuery`; update `setWebhook` |
| `src/services/expenseManager.js` | **Create** | Session management, inline keyboard builders, callback handlers |
| `index.js` | Modify | Add command handlers, callback router, session cleanup, update `/start` |
| `src/config/env.js` | Modify | Update `allowedCategories` default to include all 12 categories |

---

## Chunk 1: Database & Telegram Utilities

### Task 1: Add Storage Functions

**Files:**
- Modify: `src/services/storage.js`

- [ ] **Step 1: Add three new functions to storage.js**

Append these functions to the end of `src/services/storage.js` (before the last export or at the end of the file):

```javascript
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
```

- [ ] **Step 2: Verify storage.js syntax**

Run: `node -c src/services/storage.js`
Expected: No output (syntax OK)

---

### Task 2: Add Telegram Inline Message Utilities

**Files:**
- Modify: `src/services/telegram.js`

- [ ] **Step 1: Add three new functions to telegram.js**

Append these functions to `src/services/telegram.js`:

```javascript
import config from '../config/env.js';
import logger from '../utils/logger.js';

// ... existing code ...

/**
 * Envía un mensaje con botones inline (inline keyboard).
 * @param {number} chatId
 * @param {string} text - Texto en formato Markdown
 * @param {Array<Array<{text: string, callback_data: string}>>} inlineKeyboard - Matriz de botones
 * @returns {Promise<{message_id: number}|null>} - Objeto de mensaje o null si falla
 */
export async function sendInlineMessage(chatId, text, inlineKeyboard) {
  try {
    const url = `${config.telegram.apiUrl}/sendMessage`;
    const response = await fetch(url, {
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
    const url = `${config.telegram.apiUrl}/editMessageText`;
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: 'Markdown'
    };

    if (newKeyboard) {
      payload.reply_markup = { inline_keyboard: newKeyboard };
    }

    const response = await fetch(url, {
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
    const url = `${config.telegram.apiUrl}/answerCallbackQuery`;
    const payload = { callback_query_id: callbackQueryId };

    if (text) {
      payload.text = text;
      payload.show_alert = showAlert;
    }

    const response = await fetch(url, {
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
```

- [ ] **Step 2: Update setWebhook to include callback_query**

Find the `setWebhook` function in `src/services/telegram.js` and change:

```javascript
// FROM:
allowed_updates: ['message']

// TO:
allowed_updates: ['message', 'callback_query']
```

The exact line should look like:
```javascript
body: JSON.stringify({
  url: config.telegram.webhookUrl,
  allowed_updates: ['message', 'callback_query']
})
```

- [ ] **Step 3: Verify telegram.js syntax**

Run: `node -c src/services/telegram.js`
Expected: No output (syntax OK)

---

### Task 3: Update allowedCategories Default

**Files:**
- Modify: `src/config/env.js`

- [ ] **Step 1: Update the allowedCategories default**

Find this line in `src/config/env.js`:
```javascript
allowedCategories: (process.env.ALLOWED_CATEGORIES || 'Otros').split(',').map((c) => c.trim())
```

Change to:
```javascript
allowedCategories: (process.env.ALLOWED_CATEGORIES || 'Alimentos,Transporte,Hogar,Salud,Educación,Ocio,Ropa,Tecnología,Servicios,Facturas,Salidas,Otros').split(',').map((c) => c.trim())
```

- [ ] **Step 2: Verify env.js syntax**

Run: `node -c src/config/env.js`
Expected: No output (syntax OK)

---

### Task 4: Commit Chunk 1

- [ ] **Step 1: Review changes**

Run: `git status`

- [ ] **Step 2: Commit**

```bash
git add src/services/storage.js src/services/telegram.js src/config/env.js
git commit -m "feat: add storage and telegram utilities for delete/edit commands

- Add getRecentExpenses, deleteExpense, updateExpense to storage.js
- Add sendInlineMessage, editMessageText, answerCallbackQuery to telegram.js
- Update setWebhook to include callback_query in allowed_updates
- Update allowedCategories default to include all 12 categories"
```

---

## Chunk 2: Expense Manager Service

### Task 5: Create Expense Manager Service

**Files:**
- Create: `src/services/expenseManager.js`

This new file centralizes session management, inline keyboard building, and callback handlers. It keeps `index.js` clean and focused on routing.

- [ ] **Step 1: Create expenseManager.js**

Create the file `src/services/expenseManager.js` with this content:

```javascript
// src/services/expenseManager.js
import { getRecentExpenses, deleteExpense, updateExpense } from './storage.js';
import { sendInlineMessage, editMessageText, answerCallbackQuery, sendMessage } from './telegram.js';
import logger from '../utils/logger.js';

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
  const text = '✏️ *¿Qué gasto querás editar?*\n\nSeleccioná uno:';

  await sendInlineMessage(chatId, text, keyboard);
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

  // Fetch expense details
  const expenses = await getRecentExpenses(userId, 50);
  const expense = expenses.find((e) => e.id === expenseId);

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

  // Fetch expense details
  const expenses = await getRecentExpenses(userId, 50);
  const expense = expenses.find((e) => e.id === expenseId);

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
    await editMessageText(chatId, messageId, `✅ Gasto eliminado correctamente.`);
    logger.info('Gasto eliminado vía /eliminar', { userId, expenseId: session.expenseId });
  } else {
    await editMessageText(chatId, messageId, `❌ No pude eliminar el gasto. Reintentá.`);
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
    const categories = ['Alimentos', 'Transporte', 'Hogar', 'Salud', 'Educación', 'Ocio', 'Ropa', 'Tecnología', 'Servicios', 'Facturas', 'Salidas', 'Otros'];
    const keyboard = buildCategoryKeyboard(categories);

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
 * Handles text input during edit session (monto, descripcion, establecimiento).
 */
export async function handleEditInput(chatId, userId, text) {
  const session = getSession(userId);

  if (!session || session.action !== 'edit' || !session.field) {
    return false; // Not in edit mode
  }

  if (isSessionExpired(userId)) {
    clearSession(userId);
    await sendMessage(chatId, '⏰ Sesión expirada. Volvé a usar /editar');
    return true;
  }

  const { expenseId, field } = session;

  // Validate and process based on field type
  if (field === 'monto') {
    const monto = parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));

    if (isNaN(monto) || monto <= 0) {
      await sendMessage(chatId, '⚠️ El monto debe ser un número mayor a 0');
      return true;
    }

    const result = await updateExpense(expenseId, userId, { monto });

    if (result.success) {
      await sendMessage(chatId, `✅ Monto actualizado correctamente`);
      logger.info('Monto editado', { userId, expenseId, newMonto: monto });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar el monto. Reintentá.');
    }
  } else if (field === 'descripcion') {
    const result = await updateExpense(expenseId, userId, { descripcion: text });

    if (result.success) {
      await sendMessage(chatId, `✅ Descripción actualizada correctamente`);
      logger.info('Descripción editada', { userId, expenseId });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar la descripción. Reintentá.');
    }
  } else if (field === 'establecimiento') {
    const result = await updateExpense(expenseId, userId, { establecimiento: text });

    if (result.success) {
      await sendMessage(chatId, `✅ Establecimiento actualizado correctamente`);
      logger.info('Establecimiento editado', { userId, expenseId });
    } else {
      await sendMessage(chatId, '❌ No pude actualizar el establecimiento. Reintentá.');
    }
  }

  // Clear session
  clearSession(userId);
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

function formatNumber(num) {
  return num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c src/services/expenseManager.js`
Expected: No output (syntax OK)

---

### Task 6: Integrate Expense Manager into index.js

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Add imports**

At the top of `index.js`, add after the existing imports:

```javascript
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
  cleanupExpiredSessions
} from './src/services/expenseManager.js';
```

- [ ] **Step 2: Add command handlers BEFORE the catch-all**

In the `handleMessage` function, find the section with command handling (after `/resumen` but before `if (text.startsWith('/'))`):

```javascript
// Command /eliminar
if (text === '/eliminar') {
  await handleEliminarCommand(chatId, userId);
  logger.info('/eliminar ejecutado', { chatId, userId, latencyMs: Date.now() - startTime });
  return;
}

// Command /editar
if (text === '/editar') {
  await handleEditarCommand(chatId, userId);
  logger.info('/editar ejecutado', { chatId, userId, latencyMs: Date.now() - startTime });
  return;
}
```

- [ ] **Step 3: Update webhook to handle callback queries**

Find the webhook handler and update it:

```javascript
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
```

- [ ] **Step 4: Add callback query handler**

Add this function before `handleMessage`:

```javascript
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
    } catch {}
  }
}
```

Don't forget to import `answerCallbackQuery` from telegram.js in the imports.

- [ ] **Step 5: Add session cleanup interval**

After `app.listen(...)`, add:

```javascript
// Periodic session cleanup (every minute)
setInterval(() => {
  cleanupExpiredSessions();
}, 60 * 1000);
```

- [ ] **Step 6: Update /start message**

Find the `/start` handler and update the message:

```javascript
if (text === '/start') {
  await sendMessage(chatId,
    '👋 *¡Hola! Soy tu bot de gastos.*\n\n' +
    'Enviame un mensaje como:\n' +
    '• _"Gasté 5000 en el super"_\n' +
    '• _"450 café starbucks"_\n' +
    '• _"Uber 2300"_\n\n' +
    'Yo extraigo el monto y la categoría automáticamente.\n\n' +
    '📊 Usá /resumen para ver tu reporte del mes.\n' +
    '✏️ Usá /editar para modificar un gasto.\n' +
    '🗑️ Usá /eliminar para borrar un gasto.'
  );
  return;
}
```

- [ ] **Step 7: Import answerCallbackQuery**

Update the telegram.js import at the top:

```javascript
import { sendTyping, sendMessage, setWebhook, answerCallbackQuery } from './src/services/telegram.js';
```

- [ ] **Step 8: Verify syntax**

Run: `node -c index.js`
Expected: No output (syntax OK)

---

### Task 7: Test Locally

- [ ] **Step 1: Start the server**

Run: `npm run dev`

Expected output:
```
[timestamp] INFO: Servidor iniciado en puerto 3000 (development)
[timestamp] INFO: Webhook establecido
```

- [ ] **Step 2: Test basic functionality**

Send these messages to the bot on Telegram:
1. `/start` — Should show updated message with new commands
2. `/eliminar` — Should show recent expenses with inline buttons (or "No tenés gastos recientes")
3. `/editar` — Should show recent expenses with inline buttons (or "No tenés gastos recientes")

- [ ] **Step 3: Verify callback routing**

If you have expenses in the database:
1. Click an expense in `/eliminar` — Should show confirmation dialog
2. Click "Cancelar" — Should cancel
3. Click an expense in `/editar` — Should show field buttons
4. Click "Cancelar" — Should cancel

- [ ] **Step 4: Stop the server**

Press `Ctrl+C`

---

### Task 8: Commit Chunk 2

- [ ] **Step 1: Review changes**

Run: `git status`

- [ ] **Step 2: Commit**

```bash
git add src/services/expenseManager.js index.js
git commit -m "feat: add /eliminar and /editar commands with inline keyboards

- Create expenseManager.js with session management and callback handlers
- Add callback query routing in webhook handler
- Update /start message with new commands
- Add periodic session cleanup
- Integrate all handlers into index.js"
```

---

## Chunk 3: End-to-End Testing & Deployment

### Task 9: Full Integration Test

- [ ] **Step 1: Start the server**

Run: `npm run dev`

- [ ] **Step 2: Test delete flow**

On Telegram:
1. First, add a test expense: `"gasté 100 en test"`
2. Send `/eliminar`
3. Click the test expense button
4. Click "✅ Confirmar eliminación"
5. Verify success message
6. Send `/resumen` to verify the expense was deleted

- [ ] **Step 3: Test edit flow - monto**

1. Add another test expense: `"gasté 200 en test dos"`
2. Send `/editar`
3. Click the test expense
4. Click "💰 Monto"
5. Send: `"350"`
6. Verify: "✅ Monto actualizado correctamente"
7. Send `/resumen` to verify the change

- [ ] **Step 4: Test edit flow - category**

1. Send `/editar`
2. Click an expense
3. Click "🏷️ Categoría"
4. Click a different category
5. Verify: "✅ Categoría actualizada"
6. Send `/resumen` to verify

- [ ] **Step 5: Test edit flow - description**

1. Send `/editar`
2. Click an expense
3. Click "📝 Descripción"
4. Send: `"Nueva descripción"`
5. Verify: "✅ Descripción actualizada correctamente"

- [ ] **Step 6: Test error cases**

1. Send `/editar` when no expenses exist (if possible) — Should show "No tenés gastos recientes"
2. During edit, send invalid monto: `"abc"` — Should show "⚠️ El monto debe ser un número mayor a 0"
3. During edit, send negative monto: `"-50"` — Should show error
4. Click "❌ Cancelar" at any point — Should cancel and clear session

- [ ] **Step 7: Check logs**

Review the console output for any errors or warnings. All operations should log correctly.

- [ ] **Step 8: Stop the server**

Press `Ctrl+C`

---

### Task 10: Deploy to Production

- [ ] **Step 1: Commit all changes**

```bash
git status
git add .
git commit -m "feat: complete delete/edit expense functionality

- Database layer: getRecentExpenses, deleteExpense, updateExpense
- Telegram utilities: sendInlineMessage, editMessageText, answerCallbackQuery
- Expense manager: session management, inline keyboards, callback handlers
- Webhook: callback query routing
- Updated /start with new commands
- All 12 categories in allowedCategories default"
```

- [ ] **Step 2: Push to GitHub**

```bash
git push
```

- [ ] **Step 3: Wait for Render deployment** (~2 minutes)

Monitor at: https://bot-finanzas-7p3d.onrender.com/health

- [ ] **Step 4: Verify webhook info**

Run:
```bash
curl https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo | jq .
```

Check that `allowed_updates` includes both `"message"` and `"callback_query"`.

- [ ] **Step 5: Test on production**

On Telegram, test the same flows as in Task 9:
1. `/start` — Updated message
2. `/eliminar` — Inline buttons work
3. `/editar` — Field editing works
4. Delete an expense
5. Edit a monto
6. Edit a category

- [ ] **Step 6: Verify dashboard reflects changes**

Open: `https://bot-finanzas-7p3d.onrender.com/dashboard.html`

Check that:
- Deleted expenses no longer appear
- Edited expenses show updated values
- Totals and charts reflect the changes

---

### Task 11: Final Commit (if needed)

- [ ] **Step 1: Check for any remaining changes**

```bash
git status
```

- [ ] **Step 2: Commit if needed**

```bash
git add .
git commit -m "fix: address production issues"
git push
```

---

## Testing Checklist

After implementation, verify:

- [ ] `/eliminar` shows up to 10 most recent expenses with inline buttons
- [ ] Clicking expense shows confirmation dialog with details
- [ ] "✅ Confirmar" deletes expense from database
- [ ] "❌ Cancelar" cancels without deleting
- [ ] Can't delete another user's expense (ownership check)
- [ ] `/editar` shows up to 10 most recent expenses with inline buttons
- [ ] Clicking expense shows field buttons (monto, categoría, descripción, establecimiento)
- [ ] Editing monto updates correctly with validation
- [ ] Editing categoría shows category keyboard and updates correctly
- [ ] Editing descripción/establecimiento works with text input
- [ ] Invalid monto input shows appropriate error
- [ ] Session expires after 5 minutes
- [ ] Callback from wrong context ignored
- [ ] `/start` message includes new commands
- [ ] Inline keyboards render correctly on mobile
- [ ] Multiple rapid clicks don't cause issues (double-processing protection)
- [ ] Webhook includes `callback_query` in `allowed_updates`
- [ ] Dashboard reflects all changes in real-time
- [ ] Logs show all operations correctly
- [ ] No regression in existing functionality (expense creation, /resumen)

---

## Rollback Plan

If something breaks in production:

```bash
git revert HEAD~3..HEAD
git push
```

This reverts the last 3 commits (delete/edit feature).

---

## Notes

- **No database migration required** — existing schema supports all operations
- **Webhook auto-re-registers** on server startup with new `allowed_updates`
- **Session state is in-memory** — lost on restart (acceptable for personal bot)
- **All operations have ownership checks** — users can only modify their own expenses
- **Logging is comprehensive** — all delete/edit operations are logged with userId and expenseId
