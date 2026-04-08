// src/services/resumen.js (con RPC nativo)
import supabase from '../config/supabase.js';
import logger from '../utils/logger.js';

/**
 * Genera resumen mensual agrupado por categoría.
 * Intenta usar la función SQL nativa via RPC. Si falla, hace fallback a query + JS.
 * @param {number} telegramUserId
 * @returns {Promise<string>} - Texto formateado en Markdown para Telegram.
 */
export async function getResumen(telegramUserId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed para SQL

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const monthLabel = monthNames[month - 1];

  try {
    let grouped;
    let totalRegistros = 0;

    // Intentar RPC nativa (GROUP BY + SUM en PostgreSQL)
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('resumen_mensual', {
        p_user_id: telegramUserId,
        p_year: year,
        p_month: month
      });

    if (!rpcError && rpcData && rpcData.length > 0) {
      grouped = rpcData.map((r) => [r.categoria, Number(r.total)]);
      totalRegistros = rpcData.reduce((sum, r) => sum + Number(r.cantidad), 0);
    } else {
      // Fallback: query directo + agrupación en JS
      if (rpcError) {
        logger.info('RPC resumen_mensual no disponible, usando fallback', { error: rpcError.message });
      }

      const startOfMonth = new Date(year, month - 1, 1).toISOString();
      const endOfMonth = new Date(year, month, 1).toISOString();

      const { data, error } = await supabase
        .from('gastos')
        .select('categoria, monto')
        .eq('telegram_user_id', telegramUserId)
        .gte('created_at', startOfMonth)
        .lt('created_at', endOfMonth)
        .order('categoria');

      if (error) {
        logger.error('Error obteniendo resumen', { telegramUserId, error: error.message });
        return '❌ No pude obtener el resumen. Reintentá.';
      }

      if (!data || data.length === 0) {
        return `📊 *Resumen de ${monthLabel} ${year}*\n\nNo tenés gastos registrados este mes. ¡Empezá enviándome uno!`;
      }

      const groupMap = {};
      for (const row of data) {
        const cat = row.categoria || 'Otros';
        groupMap[cat] = (groupMap[cat] || 0) + row.monto;
      }
      grouped = Object.entries(groupMap).sort((a, b) => b[1] - a[1]);
      totalRegistros = data.length;
    }

    if (grouped.length === 0) {
      return `📊 *Resumen de ${monthLabel} ${year}*\n\nNo tenés gastos registrados este mes. ¡Empezá enviándome uno!`;
    }

    const total = grouped.reduce((sum, [, val]) => sum + val, 0);

    let msg = `📊 *Resumen de ${monthLabel} ${year}*\n\n`;

    for (const [cat, sum] of grouped) {
      const pct = ((sum / total) * 100).toFixed(1);
      const bar = getBar(sum / total);
      msg += `${bar} *${cat}*: $${formatNumber(sum)} (${pct}%)\n`;
    }

    msg += `\n💰 *Total del mes*: $${formatNumber(total)}`;
    msg += `\n📝 *Registros*: ${totalRegistros}`;

    return msg;
  } catch (err) {
    logger.error('Error en resumen', { telegramUserId, error: err.message });
    return '❌ No pude obtener el resumen. Reintentá.';
  }
}

function getBar(ratio) {
  const filled = Math.round(ratio * 8);
  return '▓'.repeat(filled) + '░'.repeat(8 - filled);
}

function formatNumber(num) {
  return num.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
