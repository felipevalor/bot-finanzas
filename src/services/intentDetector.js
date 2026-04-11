// src/services/intentDetector.js
import groq from '../config/groq.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Eres un detector de intenciones para un bot de gastos. Analizá el mensaje y devolvé SOLO JSON válido.

Posibles intenciones:
- "create": El usuario quiere registrar un gasto nuevo (ej: "gasté 5000 en café", "1700 colectivo")
- "delete": El usuario quiere eliminar un gasto existente (ej: "elimina el gasto de colectivo", "borrá lo del uber", "sacá el café de hoy")
- "edit": El usuario quiere editar un gasto existente (ej: "editá el gasto del super", "cambiá lo de colectivo a 2000")
- "summary": El usuario quiere ver un resumen (ej: "resumen", "cuánto gasté este mes")
- "price_check": El usuario quiere saber cuánto pagó por un producto (ej: "que pague por la leche?", "cuanto me salio el pan?", "precio de la coca cola", "ultimo precio del arroz")
- "other": Cualquier otra cosa

REGLAS:
- Si la intención es "delete" o "edit", extraé TODOS los keywords que puedan ayudar a encontrar el gasto
- Keywords pueden ser: palabras de descripción, categoría, establecimiento, referencias de tiempo ("ayer", "hoy", "semana pasada")
- Para "delete", si el usuario dice "último" o "ultimo", poné last: true
- Para "edit", si el usuario especifica qué cambiar (monto nuevo, categoría nueva), poné los updates
- Si hay un número de ID explícito (ej: "elimina 5"), poné expenseId
- Para "price_check", extraé los keywords del producto que busca
- NUNCA inventes datos. Si no hay info, poné null o arrays vacíos

Formato de respuesta:
{
  "intention": "create|delete|edit|summary|price_check|other",
  "expenseId": number o null,
  "searchKeywords": ["palabras clave para buscar en descripción/establecimiento"],
  "productKeywords": ["palabras clave del producto a consultar, solo para price_check"],
  "category": "categoría mencionada o null",
  "timeReference": "hoy|ayer|esta semana|este mes|null",
  "isLast": true/false (solo para delete/edit),
  "updates": { "monto": number, "categoria": "string", "descripcion": "string", "establecimiento": "string" } o null
}`;

/**
 * Detecta la intención del usuario usando IA.
 * @param {string} userMessage - Mensaje del usuario.
 * @returns {Promise<object>} - Intención detectada con filtros de búsqueda.
 */
export async function detectIntent(userMessage) {
  const startTime = Date.now();

  try {
    const completion = await groq.chat.completions.create({
      model: config.groq.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    });

    const latency = Date.now() - startTime;
    const usage = completion.usage || {};

    logger.info('Intent detection', {
      latencyMs: latency,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      logger.warn('Intent detection: empty response', { userMessage });
      return { intention: 'other' };
    }

    const parsed = JSON.parse(raw);

    if (!parsed.intention) {
      logger.warn('Intent detection: no intention found', { userMessage, raw });
      return { intention: 'other' };
    }

    return parsed;
  } catch (err) {
    const latency = Date.now() - startTime;

    if (err.status === 429 || err.statusCode === 429) {
      logger.error('Intent detection: rate limit', { latencyMs: latency, error: err.message });
      return { intention: 'error', error: 'rate_limit' };
    }

    if (err instanceof SyntaxError) {
      logger.error('Intent detection: JSON parse error', { latencyMs: latency, error: err.message });
      return { intention: 'other' };
    }

    logger.error('Intent detection: error', { latencyMs: latency, error: err.message });
    return { intention: 'other' };
  }
}
