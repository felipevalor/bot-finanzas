# Design Spec: Delete & Edit Expense Commands

**Date:** 2026-04-07  
**Status:** Draft — Awaiting Review  
**Author:** Brainstorming Session

---

## Overview

Add two new commands to the bot:
- `/eliminar` — Delete a recent expense
- `/editar` — Edit a recent expense

Both commands use **Telegram inline keyboard buttons** for selection and interaction, providing a modern, fully interactive UX without requiring text input (except for the actual edited values).

---

## Architecture

### Components

```
index.js (Command handlers + callback router)
    ├── /eliminar handler
    ├── /editar handler
    ├── /start (updated with new commands)
    └── callback_query handler (new)

src/services/storage.js (Database operations)
    ├── getRecentExpenses(userId, limit) — NEW
    ├── deleteExpense(id, userId) — NEW
    ├── updateExpense(id, userId, updates) — NEW
    └── Existing: saveExpense, isDuplicate, getMonthlyTotal

src/services/telegram.js (Telegram utilities)
    ├── sendInlineMessage(chatId, text, keyboard) — NEW
    └── Existing: sendMessage, sendTyping, setWebhook
```

### State Management

In-memory Map to track edit sessions:

```javascript
const editSessions = new Map();
// Key: userId (number)
// Value: {
//   action: 'delete' | 'edit',
//   expenseId: number,
//   field?: 'monto' | 'categoria' | 'descripcion' | 'establecimiento',
//   chatId: number,
//   messageId: number, // Original inline message ID for editing
//   createdAt: Date
// }
```

**Constraints:**
- One active session per user
- Session expires after 5 minutes (cleanup on access + periodic interval)
- Lost on process restart (acceptable for personal bot)
- **Periodic cleanup**: `setInterval(() => { ... }, 60 * 1000)` removes expired sessions

---

## Database Layer

### New Storage Functions

**`getRecentExpenses(userId, limit = 10)`**
```javascript
// Returns: Array of { id, monto, categoria, descripcion, establecimiento, created_at }
// Implementation: Use Supabase JS client (no SQL function needed)
const { data } = await supabase
  .from('gastos')
  .select('id, monto, categoria, descripcion, establecimiento, created_at')
  .eq('telegram_user_id', userId)
  .order('created_at', { ascending: false })
  .limit(limit);
```

**`deleteExpense(id, userId)`**
```javascript
// Returns: { success: boolean, error?: string }
// Query: DELETE FROM gastos WHERE id = $1 AND telegram_user_id = $2
// Ownership check prevents cross-user deletion
```

**`updateExpense(id, userId, updates)`**
```javascript
// Parameters: updates = { monto?: number, categoria?: string, descripcion?: string, establecimiento?: string }
// Returns: { success: boolean, error?: string }
// Query: UPDATE gastos SET ... WHERE id = $1 AND telegram_user_id = $2
// Only updates provided fields (partial update)
```

### SQL Migration

No schema changes needed. Table already supports all operations.

**Optional helper function** (not required, using Supabase client instead):
~~~sql
-- Skipped: getRecentExpenses implemented with Supabase JS client
~~~

---

## Telegram Layer

### New Utility: `sendInlineMessage`

```javascript
/**
 * Sends a message with inline keyboard buttons.
 * @param {number} chatId
 * @param {string} text - Markdown text
 * @param {Array<Array<{text: string, callback_data: string}>>} inlineKeyboard
 * @returns {Promise<{message_id: number}>} - Message object for later editing
 */
export async function sendInlineMessage(chatId, text, inlineKeyboard) {
  // Uses Telegram API: sendMessage with reply_markup: { inline_keyboard }
  // Returns message_id for future editMessageText calls
}
```

### New Utility: `editMessageText`

```javascript
/**
 * Edits an existing message's text and/or inline keyboard.
 * @param {number} chatId
 * @param {number} messageId
 * @param {string} newText - New Markdown text
 * @param {Array<Array<{text: string, callback_data: string}>>} [newKeyboard] - Optional new keyboard
 */
export async function editMessageText(chatId, messageId, newText, newKeyboard) {
  // Uses Telegram API: editMessageText with chat_id, message_id, reply_markup
  // Used to update confirmation dialogs without sending new messages
}
```

### New Utility: `answerCallbackQuery`

```javascript
/**
 * Answers a callback query (required to stop Telegram's loading spinner).
 * MUST be called for EVERY callback within 30 seconds.
 * @param {string} callbackQueryId
 * @param {string} [text] - Optional alert text
 * @param {boolean} [showAlert] - If true, shows popup instead of notification
 */
export async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  // Uses Telegram API: answerCallbackQuery
}
```

### Callback Data Format

| Pattern | Example | Meaning |
|---------|---------|---------|
| `del:{id}` | `del:12345` | User wants to delete expense #12345 |
| `edit:{id}` | `edit:12345` | User wants to edit expense #12345 |
| `field:{name}` | `field:monto` | User selected field to edit |
| `confirm:yes` | `confirm:yes` | Confirm deletion |
| `confirm:no` | `confirm:no` | Cancel deletion |
| `cancel` | `cancel` | Cancel current operation |
| `cat:{name}` | `cat:Alimentos` | User selected category |

**Constraints:**
- Telegram callback_data limit: 64 bytes per string
- Expense IDs are BIGINT, format as string (fits easily)

---

## Command Flows

### `/eliminar` Flow

```
1. User sends: /eliminar
2. Bot fetches getRecentExpenses(userId, 10)
3. If empty: "No tenés gastos recientes"
4. Build inline keyboard:
   Row 1: [💰 $5500 - Verdulería (Alimentos)]
   Row 2: [🚗 $2300 - Uber (Transporte)]
   ...
   Last: [❌ Cancelar]
5. User clicks expense button
6. Bot stores session: { action: 'delete', expenseId: 12345, chatId, messageId, createdAt: now() }
7. Bot calls editMessageText to update the original message:
   "¿Eliminar este gasto?
   💰 $5500 | 🏷️ Alimentos | 📝 Verdulería | 📅 07/04/2026 14:30"
   [[✅ Confirmar eliminación], [❌ Cancelar]]
8. User clicks "✅ Confirmar"
9. Bot calls deleteExpense(12345, userId)
10. If success:
    - Edit message to remove keyboard: "✅ Gasto eliminado ($5500)"
    - Log action with timestamp
11. If error: "❌ No pude eliminar el gasto. Reintentá."
12. Clear session (BEFORE sending response to prevent double-processing)
```

**Error cases:**
- Expense already deleted: "❌ Este gasto ya no existe"
- Wrong user clicks: Silent ignore (check callback_query.from.id)
- Session expired: "⏰ Sesión expirada. Volvé a usar /eliminar"

### `/editar` Flow

```
1. User sends: /editar
2. Bot fetches getRecentExpenses(userId, 10)
3. If empty: "No tenés gastos recientes"
4. Build inline keyboard (same format as /eliminar)
5. User clicks expense button
6. Bot stores session: { action: 'edit', expenseId: 12345, chatId, messageId, createdAt: now() }
7. Bot calls editMessageText to show field buttons:
   "Editando gasto:
   💰 $5500 | 🏷️ Alimentos | 📝 Verdulería | 🏪 Verdulería Don José
   📅 07/04/2026 14:30

   ¿Qué campo querés modificar?"
   [[💰 Monto], [🏷️ Categoría], [📝 Descripción], [🏪 Establecimiento]]
   [❌ Cancelar]
8. User clicks "💰 Monto"
9. Bot updates session: { ..., field: 'monto' }
10. Bot calls editMessageText: "Envíame el nuevo monto:" (removes keyboard)
11. **User sends: "6000"** (text message — routed to handleEditInput)
12. Bot validates (monto > 0, numeric)
13. Bot calls updateExpense(12345, userId, { monto: 6000 })
14. Bot sends: "✅ Monto actualizado: $5500 → $6000"
15. Clear session (BEFORE sending response)
```

### Category Selection (Special Case)

When user clicks "🏷️ Categoría":
```
1. Bot shows inline keyboard with all categories (from config.allowedCategories):
   [[🍔 Alimentos], [🚗 Transporte], [🏠 Hogar], [💊 Salud]]
   [[📚 Educación], [🎮 Ocio], [👕 Ropa], [💻 Tecnología]]
   [[📋 Servicios], [📄 Facturas], [🍻 Salidas], [📦 Otros]]
   [❌ Cancelar]
2. User clicks category button
3. Bot calls updateExpense(id, userId, { categoria: 'Alimentos' })
4. Bot: "✅ Categoría actualizada: Transporte → Alimentos"
```

**Available categories** (from `config.allowedCategories` in `env.js`):
Alimentos, Transporte, Hogar, Salud, Educación, Ocio, Ropa, Tecnología, Servicios, Facturas, Salidas, Otros

**Note**: Update `config.allowedCategories` default in `env.js` to include all 12 categories (currently defaults to just 'Otros').

---

## Callback Query Handler

### Router Logic

```javascript
async function handleCallbackQuery(query) {
  const userId = query.from.id;
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const callbackId = query.id;
  const data = query.data;
  const session = editSessions.get(userId);

  // CRITICAL: Always answer callback to stop loading spinner
  const answer = (text) => answerCallbackQuery(callbackId, text);

  // 1. Check session exists (except for initial expense selection)
  if (!session && !data.startsWith('del:') && !data.startsWith('edit:')) {
    return answer('⏰ Sesión expirada. Volvé a usar /editar o /eliminar');
  }

  // 2. Check session expiry
  if (session && Date.now() - session.createdAt > 5 * 60 * 1000) {
    editSessions.delete(userId);
    return answer('⏰ Sesión expirada');
  }

  // 3. Verify chat context (prevent forwarded message clicks)
  if (session && session.chatId !== chatId) {
    return answer('❌ Contexto inválido');
  }

  // 4. Route by callback_data prefix
  if (data.startsWith('del:')) {
    return handleDeleteSelection(query, userId, chatId, messageId, data);
  } else if (data.startsWith('edit:')) {
    return handleEditSelection(query, userId, chatId, messageId, data);
  } else if (data === 'confirm:yes') {
    return handleConfirmDelete(query, userId, chatId, messageId, session);
  } else if (data === 'confirm:no' || data === 'cancel') {
    return handleCancel(query, userId, chatId, messageId);
  } else if (data.startsWith('field:')) {
    return handleFieldSelection(query, userId, chatId, messageId, data, session);
  } else if (data.startsWith('cat:')) {
    return handleCategorySelection(query, userId, chatId, messageId, data, session);
  }

  // 5. Unknown callback
  return answer('❌ Acción no reconocida');
}
```

### Text Message Routing (During Edit Sessions)

When a user has an active edit session and sends a text message, it must be routed to the edit handler instead of the normal expense parser:

```javascript
async function handleMessage({ chatId, userId, messageId, text }) {
  // ... existing /start, /resumen, /eliminar, /editar handlers ...

  // Check for active edit session BEFORE normal parsing
  const session = editSessions.get(userId);
  if (session && session.field && Date.now() - session.createdAt < 5 * 60 * 1000) {
    return handleEditInput({ chatId, userId, messageId, text, session });
  }

  // Normal expense parsing...
}
```

### `handleEditInput` Function

```javascript
async function handleEditInput({ chatId, userId, messageId, text, session }) {
  const { expenseId, field } = session;

  // 1. Validate input based on field type
  if (field === 'monto') {
    const monto = parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      await sendMessage(chatId, '⚠️ El monto debe ser un número mayor a 0');
      return;
    }
    const result = await updateExpense(expenseId, userId, { monto });
    if (result.success) {
      await sendMessage(chatId, `✅ Monto actualizado`);
    }
  } else if (field === 'descripcion') {
    const result = await updateExpense(expenseId, userId, { descripcion: text });
    if (result.success) {
      await sendMessage(chatId, `✅ Descripción actualizada`);
    }
  } else if (field === 'establecimiento') {
    const result = await updateExpense(expenseId, userId, { establecimiento: text });
    if (result.success) {
      await sendMessage(chatId, `✅ Establecimiento actualizado`);
    }
  }

  // 2. Clear session BEFORE response (prevents double-processing)
  editSessions.delete(userId);

  // 3. Log action
  logger.info('Expense edited', { userId, expenseId, field });
}
```

---

## Integration with Existing Code

### Changes to `index.js`

1. **Import new functions:**
   ```javascript
   import { getRecentExpenses, deleteExpense, updateExpense } from './src/services/storage.js';
   import { sendInlineMessage, editMessageText, answerCallbackQuery } from './src/services/telegram.js';
   ```

2. **Add to handleMessage (BEFORE the `text.startsWith('/')` catch-all):**
   ```javascript
   // CRITICAL: These handlers must be BEFORE the generic command catch-all
   if (text === '/eliminar') {
     return handleEliminarCommand({ chatId, userId, messageId });
   }
   if (text === '/editar') {
     return handleEditarCommand({ chatId, userId, messageId });
   }

   // Check for active edit session (text input during edit)
   const session = editSessions.get(userId);
   if (session?.field && Date.now() - session.createdAt < 5 * 60 * 1000) {
     return handleEditInput({ chatId, userId, messageId, text, session });
   }
   ```

3. **Add callback handler to webhook:**
   ```javascript
   app.post('/webhook', (req, res) => {
     res.sendStatus(200);

     // Route callback queries
     if (req.body?.callback_query) {
       enqueue(() => handleCallbackQuery(req.body.callback_query));
       return;
     }

     // Route messages
     if (req.body?.message?.text) {
       enqueue(() => handleMessage({ ... }));
     }
   });
   ```

4. **Update `/start` message:**
   Add new commands to welcome message:
   ```
   📊 Usá /resumen para ver tu reporte del mes.
   ✏️ Usá /editar para modificar un gasto.
   🗑️ Usá /eliminar para borrar un gasto.
   ```

5. **Add periodic session cleanup:**
   ```javascript
   // In server startup
   setInterval(() => {
     const now = Date.now();
     for (const [userId, session] of editSessions.entries()) {
       if (now - session.createdAt > 5 * 60 * 1000) {
         editSessions.delete(userId);
       }
     }
   }, 60 * 1000); // Run every minute
   ```

### Changes to `src/services/storage.js`

Add three new exported functions (see Database Layer section above).

### Changes to `src/services/telegram.js`

Add three new exported functions (see Telegram Layer section above).

**Important**: Use `fetch` (not axios) to match existing patterns in the codebase.

**Update `setWebhook` to include callback_query:**
```javascript
// Current (broken):
allowed_updates: ['message']

// New (required for callbacks):
allowed_updates: ['message', 'callback_query']
```

---

## Error Handling

| Error | User Message | Logging |
|-------|--------------|---------|
| No expenses | "No tenés gastos recientes" | info |
| Expense not found | "❌ Este gasto ya no existe" | warn |
| Wrong user | (silent ignore) | info |
| Session expired | "⏰ Sesión expirada. Volvé a usar /comando" | info |
| Invalid monto | "⚠️ El monto debe ser un número mayor a 0" | warn |
| Invalid category | "⚠️ Categoría no válida. Elegí una de la lista." | warn |
| DB error (delete) | "❌ No pude eliminar el gasto. Reintentá." | error |
| DB error (update) | "❌ No pude actualizar el gasto. Reintentá." | error |
| Telegram API error | "⚠️ Problema técnico. Reintentá." | error |

---

## Testing Strategy

### Manual Testing Checklist

- [ ] `/eliminar` shows 10 most recent expenses
- [ ] Clicking expense shows confirmation dialog
- [ ] Confirm deletes expense from database
- [ ] Cancel does nothing
- [ ] Can't delete another user's expense
- [ ] `/editar` shows 10 most recent expenses
- [ ] Clicking expense shows field buttons
- [ ] Editing monto updates correctly
- [ ] Editing categoria shows category keyboard
- [ ] Editing descripcion/establecimiento works
- [ ] Invalid monto input shows error
- [ ] Session expiry works (wait 5 min)
- [ ] Callback from wrong user ignored
- [ ] `/start` message updated with new commands
- [ ] Inline keyboard renders correctly on mobile
- [ ] Multiple rapid clicks don't cause issues

### Edge Cases

- User sends text message while in edit session → Process as edit value if session.active
- User clicks button after session expired → Show expiry message
- User deletes expense that was already shown in list → Handle gracefully
- Expense with null descripcion/establecimiento → Show "-" in display

---

## Security Considerations

1. **Ownership checks**: All delete/update operations verify `telegram_user_id` matches
2. **Session isolation**: Each user has separate session (Map keyed by userId)
3. **Input validation**: monto must be > 0, category must be in allowed list
4. **No SQL injection**: Using Supabase parameterized queries
5. **Callback validation**: Verify callback_query.from.id matches session userId

---

## Performance

- **getRecentExpenses**: Indexed query (idx_gastos_user_date), fast even with 100K+ rows
- **deleteExpense**: Single row DELETE by primary key, ~10ms
- **updateExpense**: Single row UPDATE by primary key, ~10ms
- **Inline keyboard**: Built in memory, <5ms for 10 buttons
- **Session Map**: O(1) lookup, negligible overhead

---

## Future Enhancements (Not in Scope)

- Bulk delete (select multiple expenses)
- Undo delete (soft delete with 30s grace period)
- Export to CSV before delete
- Edit via text message (alternative to inline buttons)
- Search expenses by date range or keyword
- Revert to previous version (audit log)

---

## Migration Steps

1. **Deploy code changes:**
   ```bash
   git add .
   git commit -m "feat: add /eliminar and /editar commands with inline buttons"
   git push
   ```
   Render will auto-deploy (~2 minutes).

2. **Webhook re-registration** (happens automatically on server startup):
   The `setWebhook()` call in `index.js` startup will re-register with `allowed_updates: ['message', 'callback_query']`.
   
   Verify with:
   ```bash
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo
   ```
   Check that `allowed_updates` includes `callback_query`.

3. **Verify in production:**
   - Test `/eliminar` with a non-critical expense
   - Test `/editar` with monto change
   - Test category editing
   - Check dashboard reflects changes

---

## Files to Modify

| File | Changes |
|------|---------|
| `index.js` | Add command handlers, callback router, update /start |
| `src/services/storage.js` | Add getRecentExpenses, deleteExpense, updateExpense |
| `src/services/telegram.js` | Add sendInlineMessage, answerCallbackQuery, editMessageText |
| `scripts/init-db.sql` | Add get_recent_expenses function |
| `public/dashboard.html` | No changes needed |

---

## Success Criteria

- User can delete any recent expense in <10 seconds
- User can edit any field of a recent expense in <15 seconds
- No data loss or corruption
- No regression in existing functionality
- Inline buttons work on mobile and desktop Telegram
