// src/services/parser.js
import groq from '../config/groq.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Eres un extractor de datos financieros. Analiza el mensaje y devuelve SOLO JSON válido:
{
  "monto": number,
  "categoria": "string (exactamente una de: ${config.allowedCategories.join(',')})",
  "descripcion": "string corto o null",
  "establecimiento": "string o null"
}
REGLAS:
- Si no hay monto numérico claro, devuelve {"error": "No detecté un monto. Ej: 'Gasté 5000 en café'"}
- Usa la fecha de hoy si no se menciona otra
- Nunca inventes datos. Si falta info, pon null
- NO agregues texto fuera del JSON`;

/**
 * Parsea un mensaje de texto con Groq y devuelve el JSON extraído.
 * @param {string} userMessage - Texto del usuario.
 * @returns {Promise<object>} - JSON parseado con monto/categoria/descripcion/establecimiento o error.
 */
export async function parseExpense(userMessage) {
  const startTime = Date.now();

  try {
    const completion = await groq.chat.completions.create({
      model: config.groq.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 256,
      response_format: { type: 'json_object' }
    });

    const latency = Date.now() - startTime;
    const usage = completion.usage || {};

    logger.info('Groq response', {
      latencyMs: latency,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return { error: 'Respuesta vacía de la IA.' };
    }

    const parsed = JSON.parse(raw);

    // Validación de error del modelo
    if (parsed.error) {
      return { error: parsed.error };
    }

    // Validaciones de campos obligatorios
    if (typeof parsed.monto !== 'number' || parsed.monto <= 0) {
      return { error: 'No detecté un monto válido. Ej: "Gasté 5000 en café"' };
    }

    // Normalizar categoría
    if (!config.allowedCategories.includes(parsed.categoria)) {
      parsed.categoria = 'Otros';
    }

    return {
      monto: parsed.monto,
      categoria: parsed.categoria,
      descripcion: parsed.descripcion || null,
      establecimiento: parsed.establecimiento || null
    };
  } catch (err) {
    const latency = Date.now() - startTime;

    // Rate limit (429)
    if (err.status === 429 || err.statusCode === 429) {
      logger.error('Groq rate limit', { latencyMs: latency, error: err.message });
      return { error: '⚠️ Problema técnico momentáneo. Reintentá en 30s.' };
    }

    // JSON parse error
    if (err instanceof SyntaxError) {
      logger.error('Groq JSON parse error', { latencyMs: latency, error: err.message });
      return { error: 'No pude interpretar la respuesta. Intentá de nuevo.' };
    }

    logger.error('Groq error', { latencyMs: latency, error: err.message, stack: err.stack });
    return { error: '⚠️ Problema técnico momentáneo. Reintentá en 30s.' };
  }
}
