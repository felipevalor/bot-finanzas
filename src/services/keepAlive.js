// keepAlive.js — Self-pinging keep-alive to prevent Render spin-down
import https from 'https';
import logger from '../utils/logger.js';

const PING_INTERVAL = 13 * 60 * 1000; // 13 minutes (Render spins down after 15 min)
const PING_TIMEOUT = 10000; // 10 seconds

/**
 * Periodically hits the /health endpoint to keep Render free tier awake.
 * Only runs in production (not during local dev).
 */
export function startKeepAlive(app) {
  // Don't ping ourselves during local development
  if (process.env.NODE_ENV !== 'production') {
    logger.info('Keep-alive disabled (not in production)');
    return;
  }

  const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';
  const url = `https://${hostname}/health`;

  async function ping() {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: PING_TIMEOUT }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ status: res.statusCode, body: data });
          } else {
            reject(new Error(`Ping failed: HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ping timeout'));
      });
    });
  }

  setInterval(async () => {
    try {
      await ping();
      logger.info('Keep-alive ping OK', { url });
    } catch (err) {
      logger.warn('Keep-alive ping failed', { url, error: err.message });
    }
  }, PING_INTERVAL);

  logger.info(`Keep-alive scheduled every 13 minutes → ${url}`);
}
