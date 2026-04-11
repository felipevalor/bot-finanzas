// src/services/receiptParser.js
import groq from '../config/groq.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Eres un asistente que extrae datos de recibos, facturas y tickets de compra.

Tu tarea es analizar la imagen y extraer la información en formato JSON.

IMPORTANTE:
- Puede ser CUALQUIER tipo de comprobante: factura, ticket, recibo, nota de venta, etc.
- El recibo puede estar en ESPAÑOL
- Busca el IMPORTE TOTAL o TOTAL FINAL
- Si ves un nombre de comercio/empresa, extráelo
- Si hay una fecha, extráela

FORMATO JSON:
{
  "monto": <número del total final>,
  "establecimiento": "<nombre del comercio o null si no hay>",
  "descripcion": "<breve descripción o null>",
  "categoria": "<una de: ${config.allowedCategories.join(',')}>",
  "fecha": "<YYYY-MM-DD o null>",
  "confianza": "<alta|media|baja>",
  "items": [
    {
      "nombre": "<nombre del producto tal como aparece en el recibo>",
      "precio": <precio unitario numérico>,
      "cantidad": <cantidad numérica, default 1>,
      "unidad": "<kg|lt|un|null>"
    }
  ]
}

REGLAS:
- Si la imagen tiene texto pero no parece un recibo, igualmente tratá de extraer el monto
- Si no encontrás un campo, poné null (NO inventes)
- Marcá confianza como "baja" si la imagen está muy borrosa o cortada
- Si podés identificar productos individuales con sus precios, incluirlos en items
- Si no podés distinguir ítems individuales, devolvé items como array vacío []
- precio en items es el precio UNITARIO (no el subtotal si hay múltiples unidades)
- DEVOLVÉ SOLO JSON, sin markdown ni texto adicional`;

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
      model: config.groq.visionModel,
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
      max_tokens: 1024,
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
      logger.warn('Groq Vision returned explicit error', { error: parsed.error });
      return { error: parsed.error };
    }

    // Validate monto - more lenient
    if (typeof parsed.monto !== 'number' || parsed.monto <= 0) {
      logger.warn('No valid monto found', { parsedResponse: parsed });
      
      // If we have establishment or other data, return partial result
      if (parsed.establecimiento || parsed.descripcion) {
        return {
          monto: null, // Signal that we need user to provide this
          categoria: parsed.categoria || 'Otros',
          descripcion: parsed.descripcion || null,
          establecimiento: parsed.establecimiento || null,
          fecha: parsed.fecha || null,
          confianza: parsed.confianza || 'baja',
          partialData: true // Flag to trigger different flow
        };
      }
      
      return { error: 'No detecté un monto válido en el recibo. Asegurate de que se vea claramente el total.' };
    }

    // Normalize categoría
    if (!parsed.categoria || !config.allowedCategories.includes(parsed.categoria)) {
      parsed.categoria = 'Otros';
    }

    // Validate and normalize items array
    let items = [];
    if (Array.isArray(parsed.items)) {
      items = parsed.items
        .filter(item => item.nombre && typeof item.precio === 'number' && item.precio > 0)
        .map(item => ({
          nombre: String(item.nombre).trim(),
          precio: item.precio,
          cantidad: typeof item.cantidad === 'number' && item.cantidad > 0 ? item.cantidad : 1,
          unidad: item.unidad || null
        }));
    }

    return {
      monto: parsed.monto,
      categoria: parsed.categoria,
      descripcion: parsed.descripcion || null,
      establecimiento: parsed.establecimiento || null,
      fecha: parsed.fecha || null,
      confianza: parsed.confianza || 'media',
      items
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
