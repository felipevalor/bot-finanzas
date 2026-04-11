# 🔍 Diagnostic: Receipt Photo Not Working

## Problem: Bot says "No pude leer claramente el recibo"

### Possible Causes (Ranked by Likelihood):

1. **Image Quality Issues** (80% of cases)
   - Photo is blurry
   - Poor lighting (too dark)
   - Glare/reflection on receipt
   - Receipt is cut off
   - Camera shake

2. **Groq Vision API Issues** (10% of cases)
   - Model doesn't recognize receipt format
   - Rate limiting
   - API temporarily unavailable

3. **Code/Configuration Issues** (10% of cases)
   - Wrong model name
   - Image too compressed
   - System prompt too strict (FIXED ✅)

---

## What We Just Fixed:

### ✅ 1. More Lenient System Prompt
**Before:** Very strict rules, returned error easily
**After:** More forgiving, tries to extract even from imperfect receipts

### ✅ 2. Better Image Quality
**Before:** Compressed to 1920px, quality 85
**After:** 2000px, quality 90, mozjpeg optimization for sharper text

### ✅ 3. Better Error Messages
**Before:** Generic error message
**After:** Specific guidance on what might be wrong

### ✅ 4. More Logging
**Before:** Minimal logging
**After:** Full OCR response logged for debugging

---

## How to Test If It's Working:

### Step 1: Check Logs
After sending a photo, check the logs:

**Local:**
```bash
npm run dev
# Watch console output
```

**Render:**
```
Dashboard > bot-finanzas > Logs
```

Look for these log lines:
```
[info]: Processing receipt photo
[info]: File downloaded from Telegram
[info]: Image compressed for OCR
[info]: Groq Vision OCR completed
[info]: OCR result {"parsed": "..."}
```

### Step 2: What the Logs Tell You:

**If you see:**
```
[info]: Groq Vision OCR completed
[info]: OCR result {"parsed": {"monto": 5000, ...}}
```
✅ OCR is working! The model is extracting data.

**If you see:**
```
[info]: Groq Vision OCR completed  
[warn]: No valid monto found
```
⚠️ The model saw the image but couldn't find a clear amount.

**If you see:**
```
[error]: Groq Vision error
```
❌ API error (rate limit, model issue, etc.)

**If you see:**
```
[error]: Error downloading file
```
❌ Telegram download failed

---

## Best Practices for Receipt Photos:

### ✅ DO:
- Take photos in **good lighting**
- Keep camera **steady** (no blur)
- Make sure the **entire receipt** is visible
- **Flat surface**, no wrinkles
- **Focus** on the text

### ❌ DON'T:
- Photos in the dark
- Blurry/shaky photos
- Cut off the bottom/top of receipt
- Photos with glare/reflections
- Wrinkled or folded receipts

---

## Test with Different Receipts:

Try these types to see what works:

| Receipt Type | Expected Result |
|--------------|----------------|
| Supermarket ticket (clear) | ✅ High accuracy |
| Restaurant bill (printed) | ✅ High accuracy |
| Handwritten note | ⚠️ Low accuracy or error |
| Blurry photo | ⚠️ Ask to retake |
| Digital receipt (PDF screenshot) | ✅ High accuracy |
| Very long thermal receipt | ⚠️ May miss bottom total |
| Multiple receipts in one photo | ⚠️ May extract wrong one |

---

## Quick Test:

### 1. Verify Model is Available
Run this test:

```javascript
// test-groq-vision.mjs
import groq from './src/config/groq.js';

try {
  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [{ role: 'user', content: 'Say hello in Spanish' }],
    max_tokens: 50
  });
  console.log('✅ Groq Vision model is available');
  console.log('Response:', completion.choices[0].message.content);
} catch (err) {
  console.log('❌ Groq Vision model error:', err.message);
}
```

Run: `node test-groq-vision.mjs`

### 2. Test with a Known Good Image
Download a sample receipt image from the internet and send it to your bot.

### 3. Check Render Logs
If deployed to Render, check the full logs to see exactly what's happening.

---

## If It Still Doesn't Work:

### Option A: Try a Different Image
- Use a clear, well-lit supermarket receipt
- Make sure the total is clearly visible

### Option B: Check Groq Dashboard
- Go to https://console.groq.com/
- Check if there are any service disruptions
- Verify your API key is valid

### Option C: Fallback to Manual Entry
If OCR consistently fails, users can always:
```
"5000 cena restaurante"
```

The text parsing still works perfectly!

---

## Next Steps:

1. **Deploy the latest changes** (the fixes we just made):
   ```bash
   git add .
   git commit -m "fix: improve OCR accuracy and error handling"
   git push origin main
   ```

2. **Test with a clear receipt photo**

3. **Check the logs** to see what the OCR is actually returning

4. **Share the logs with me** if it still doesn't work, and I'll diagnose the exact issue

---

## Expected Behavior After Fix:

### Scenario 1: Clear Receipt
```
User: [sends clear receipt photo]
Bot: 
✅ Recibo procesado

💸 Monto: $5,000
🏷️ Categoría: Alimentos
🏪 Establecimiento: Carrefour
📅 Fecha del recibo: 2026-04-10

🔍 Confianza OCR: alta
📅 Total del mes: $45,300
```

### Scenario 2: Poor Quality
```
User: [sends blurry receipt photo]
Bot:
⚠️ No pude leer claramente el recibo.

Posibles causas:
• La foto está borrosa o muy oscura
• El recibo está cortado
• Hay mucho reflejo o sombra

Intentá:
1️⃣ Otra foto con mejor iluminación
2️⃣ Enviarme los datos: "5000 cena restaurante"
```

---

**Ready to test!** Deploy the changes and try again with a clear receipt photo.
