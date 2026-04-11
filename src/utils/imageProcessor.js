// src/utils/imageProcessor.js
import sharp from 'sharp';
import logger from './logger.js';

/**
 * Compresses image to fit within size limit (for Groq Vision API constraints).
 * @param {Buffer} imageBuffer - Original image
 * @param {number} maxSizeMB - Max size in MB (default 3.5)
 * @returns {Promise<Buffer>} - Compressed image
 */
export async function compressImage(imageBuffer, maxSizeMB = 3.5) {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  // If already small enough, still optimize for OCR
  try {
    const metadata = await sharp(imageBuffer).metadata();
    
    // Convert to JPEG with high quality for OCR (keep text sharp)
    if (metadata.format !== 'jpeg') {
      logger.info('Converting image to JPEG for OCR', { 
        fromFormat: metadata.format, 
        originalSize: imageBuffer.length,
        dimensions: `${metadata.width}x${metadata.height}`
      });
      return await sharp(imageBuffer)
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true }) // Higher quality for better OCR
        .toBuffer();
    }
    
    // Already JPEG and under size limit
    if (imageBuffer.length < maxSizeBytes) {
      return imageBuffer;
    }
  } catch (err) {
    logger.error('Error checking image metadata, compressing anyway', { error: err.message });
  }

  // Iteratively reduce quality until under limit
  let quality = 90;
  let compressed = await sharp(imageBuffer)
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (compressed.length > maxSizeBytes && quality > 40) {
    quality -= 10;
    compressed = await sharp(imageBuffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  logger.info('Image compressed for OCR', {
    originalSize: imageBuffer.length,
    compressedSize: compressed.length,
    compressionRatio: ((1 - compressed.length / imageBuffer.length) * 100).toFixed(1) + '%',
    finalQuality: quality
  });

  return compressed;
}

/**
 * Validates image format and size.
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<object>} - Image metadata
 */
export async function validateImage(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();

    const allowedFormats = ['jpeg', 'png', 'webp'];
    if (!allowedFormats.includes(metadata.format)) {
      throw new Error(`Formato no soportado: ${metadata.format}. Usá JPEG, PNG o WebP.`);
    }

    const maxSizeMB = 10; // Telegram's max limit
    if (buffer.length > maxSizeMB * 1024 * 1024) {
      throw new Error(`Imagen demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máx: ${maxSizeMB}MB`);
    }

    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      size: buffer.length
    };
  } catch (err) {
    if (err.message.includes('soportado') || err.message.includes('demasiado')) {
      throw err; // Re-throw validation errors
    }
    logger.error('Error validating image', { error: err.message });
    throw new Error('No pude procesar la imagen. Asegurate de que sea un JPEG, PNG o WebP válido.');
  }
}

/**
 * Gets the largest photo from Telegram's photo array.
 * @param {Array<{file_id: string, file_size: number, width: number, height: number}>} photos
 * @returns {{file_id: string, file_size: number, width: number, height: number}}
 */
export function getLargestPhoto(photos) {
  // Telegram sends photos in ascending order of size, so last is largest
  const largest = photos[photos.length - 1];
  logger.info('Selected largest photo', {
    photoCount: photos.length,
    selectedSize: largest.file_size,
    selectedDimensions: `${largest.width}x${largest.height}`
  });
  return largest;
}
