// src/services/receiptParser.js
import groq from '../config/groq.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Eres un extractor de datos de recibos y facturas comerciales.

Analiza la imagen del recibo y devuelve SOLO un JSON válido con esta estructura:
{
  "monto": number,
  "categoria": "string (exactamente una de: ${config.allowedCategories.join(',')})",
  "descripcion": "string corto o null",
  "establecimiento": "string o null",
  "fecha": "YYYY-MM-DD o null",
  "confianza": "alta|media|baja"
}

REGLAS CRÍTICAS:
1. Busca el TOTAL FINAL (no sumas parciales, no subtotal sin IVA)
2. Identifica el nombre del comercio/establecimiento claramente visible
3. Si hay múltiples ítems, extrae solo el total general
4. Si la fecha es legible, extraela en formato YYYY-MM-DD
5. Si no podés leer bien algún campo, pon null (NO inventes)
6. Marcá confianza como "baja" si:
   - La imagen está borrosa
   - Hay reflejos o sombras que tapan información
   - El recibo está cortado
7. Si no hay un recibo/factura en la imagen, devuelve {"error": "No es un recibo válido"}
8. DEVUELVE SOLO JSON VÁLIDO, sin texto adicional ni markdown`;

/**
 * Parses a receipt photo using Groq Vision API.
 * @param {Buffer} imageBuffer - Compressed image buffer
 * @returns {Promise<object>} - Parsed receipt data
 */
export async function parseReceiptPhoto(imageBuffer) {
  const startTime = Date.now();

  try {
    const base64Image = imageBuffer.toString('base64');

    logger.info('Sending image to Groq Vision API', {
      imageSize: imageBuffer.length,
      base64Size: base64Image.length
    });

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extrae los datos de este recibo/factura:' },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' }
    });

    const latency = Date.now() - startTime;
    const usage = completion.usage || {};

    logger.info('Groq Vision OCR completed', {
      latencyMs: latency,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return { error: 'Respuesta vacía de la IA.' };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.error('Groq Vision JSON parse error', { raw, error: err.message });
      return { error: 'No pude interpretar el recibo. Intentá de nuevo.' };
    }

    // Check for explicit error from model
    if (parsed.error) {
      return { error: parsed.error };
    }

    // Validate monto
    if (typeof parsed.monto !== 'number' || parsed.monto <= 0) {
      return { error: 'No detecté un monto válido en el recibo.' };
    }

    // Normalize categoría
    if (!parsed.categoria || !config.allowedCategories.includes(parsed.categoria)) {
      parsed.categoria = 'Otros';
    }

    return {
      monto: parsed.monto,
      categoria: parsed.categoria,
      descripcion: parsed.descripcion || null,
      establecimiento: parsed.establecimiento || null,
      fecha: parsed.fecha || null,
      confianza: parsed.confianza || 'media'
    };
  } catch (err) {
    const latency = Date.now() - startTime;

    // Rate limit (429)
    if (err.status === 429 || err.statusCode === 429) {
      logger.error('Groq Vision rate limit', { latencyMs: latency, error: err.message });
      return { error: '⚠️ Demasiadas solicitudes. Reintentá en 30s.' };
    }

    logger.error('Groq Vision error', { latencyMs: latency, error: err.message, stack: err.stack });
    return { error: '⚠️ Error procesando la imagen. Reintentá.' };
  }
}
