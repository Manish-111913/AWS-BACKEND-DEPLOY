/**
 * Compare deterministic JS parser vs Python parser on a given image or raw text file.
 * Usage: node testing_tools/compare-parsers.js --image path/to/image.jpg
 *        node testing_tools/compare-parsers.js --text path/to/raw.txt
 * Flags: --python (force run python), --mode auto|document|text
 */
const fs = require('fs');
const path = require('path');
const OCRService = require('../utils/OCR');
const { runPythonParser } = require('../services/pythonParserService');

async function main() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--image') opts.image = args[++i];
    else if (a === '--text') opts.textFile = args[++i];
    else if (a === '--python') opts.python = true;
    else if (a === '--mode') opts.mode = args[++i];
  }
  if (!opts.image && !opts.textFile) {
    console.error('Provide --image <path> or --text <path>.');
    process.exit(1);
  }
  let rawText = '';
  if (opts.textFile) {
    rawText = fs.readFileSync(path.resolve(opts.textFile), 'utf8');
  } else if (opts.image) {
    const buf = fs.readFileSync(path.resolve(opts.image));
    const dataUri = `data:image/${path.extname(opts.image).slice(1) || 'jpeg'};base64,${buf.toString('base64')}`;
    const ocr = new OCRService();
    const r = await ocr.processImage(dataUri, { language: 'eng', mode: opts.mode || 'auto' });
    if (!r.success) {
      console.error('OCR failed:', r.error); process.exit(2);
    }
    rawText = r.rawText || '';
    console.log(`OCR raw text length: ${rawText.length}, items(js-first-pass): ${r.extractedItems?.length}`);
  }

  const ocrService = new OCRService();
  const jsStart = Date.now();
  const jsItems = await ocrService.parseReceiptText(rawText);
  const jsDuration = Date.now() - jsStart;

  console.log('\n=== JS Parser Results ===');
  console.log('Items:', jsItems.length, 'Duration(ms):', jsDuration);
  jsItems.slice(0, 10).forEach((it, idx) => console.log(idx + 1, it));

  let pyItems = []; let pyErr = null; let pyDur = null;
  if (opts.python) {
    const pyRes = await runPythonParser(rawText, { timeoutMs: 15000 });
    pyItems = pyRes.items || []; pyErr = pyRes.error; pyDur = pyRes.durationMs;
    console.log('\n=== Python Parser Results ===');
    console.log('Items:', pyItems.length, 'Duration(ms):', pyDur, 'Error:', pyErr || 'none');
    pyItems.slice(0, 10).forEach((it, idx) => console.log(idx + 1, it));
  }

  // Simple diff by item_name
  const jsNames = new Set(jsItems.map(i => i.item_name?.toLowerCase()));
  const pyNames = new Set(pyItems.map(i => i.item_name?.toLowerCase()));
  const onlyJs = [...jsNames].filter(n => !pyNames.has(n));
  const onlyPy = [...pyNames].filter(n => !jsNames.has(n));
  if (opts.python) {
    console.log('\nItems only in JS:', onlyJs);
    console.log('Items only in Python:', onlyPy);
  }
  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
