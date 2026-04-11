#!/usr/bin/env node
/**
 * Test con tu foto real del recibo
 * Ejecutar: node test-with-real-photo.mjs
 */

import { parseReceiptPhoto } from './src/services/receiptParser.js';
import { compressImage, validateImage } from './src/utils/imageProcessor.js';
import fs from 'fs';

const PHOTO_PATH = './photo_5105388803005811709_y.jpg';

console.log('🧪 Testing with YOUR receipt photo\n');

if (!fs.existsSync(PHOTO_PATH)) {
  console.log(`❌ Photo not found at: ${PHOTO_PATH}`);
  console.log(`\nMove your photo here first:`);
  console.log(`  cp /path/to/your/photo.jpg ${PHOTO_PATH}`);
  process.exit(1);
}

console.log('📷 Photo found, starting tests...\n');

// Step 1: Validate image
console.log('Step 1: Validating image...');
const imageBuffer = fs.readFileSync(PHOTO_PATH);
console.log(`   Original size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

try {
  const metadata = await validateImage(imageBuffer);
  console.log(`   Format: ${metadata.format}`);
  console.log(`   Dimensions: ${metadata.width}x${metadata.height}`);
  console.log('   ✅ Valid image\n');
} catch (err) {
  console.log(`   ❌ Invalid image: ${err.message}\n`);
  process.exit(1);
}

// Step 2: Compress image
console.log('Step 2: Compressing image for OCR...');
const compressed = await compressImage(imageBuffer, 3.5);
console.log(`   Compressed size: ${(compressed.length / 1024).toFixed(2)} KB`);
console.log(`   Compression: ${((1 - compressed.length / imageBuffer.length) * 100).toFixed(1)}%\n`);

// Step 3: Send to Groq Vision
console.log('Step 3: Sending to Groq Vision API for OCR...');
console.log('   (This may take 2-5 seconds)\n');

try {
  const result = await parseReceiptPhoto(compressed);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 OCR Result:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(JSON.stringify(result, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (result.error) {
    console.log(`❌ Error from Groq Vision: ${result.error}`);
    console.log('\nPossible fixes:');
    console.log('  1. Check your GROQ_API_KEY in .env');
    console.log('  2. Check Render logs for details');
    console.log('  3. Try with a different photo');
  } else {
    console.log('✅ SUCCESS! Groq Vision extracted:');
    console.log(`   Monto: $${result.monto}`);
    console.log(`   Categoría: ${result.categoria}`);
    console.log(`   Establecimiento: ${result.establecimiento || '(not detected)'}`);
    console.log(`   Confianza: ${result.confianza}`);
  }
  
} catch (err) {
  console.log('❌ Exception during OCR:');
  console.log(err.message);
  console.log('\nStack trace:');
  console.log(err.stack);
}
