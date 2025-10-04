// Wrapper to invoke the legacy/deprecated Python parser (receipt_parser.py)
// This allows re-enabling Python parsing after Google Vision OCR produces raw text.
// Usage: const { runPythonParser } = require('./pythonParserService');
// const { items, error, durationMs, rawStdout } = await runPythonParser(rawText);
//
// Implementation notes:
// - Pass OCR text via a temp file (safer for large payloads than argv)
// - Expect JSON on stdout: { items: [...], meta: {...} } or fallback patterns
// - Timeouts to avoid hanging processes
// - Gracefully handle absence of Python environment

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PY_SCRIPT_RELATIVE = path.join(__dirname, 'receipt_parser.py');

function ensurePythonScriptExists() {
  if (!fs.existsSync(PY_SCRIPT_RELATIVE)) {
    throw new Error(`Python parser script not found at ${PY_SCRIPT_RELATIVE}`);
  }
}

function writeTempInput(text) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocrpy-'));
  const filePath = path.join(tmpDir, 'input.txt');
  fs.writeFileSync(filePath, text, 'utf8');
  return { tmpDir, filePath };
}

/**
 * Run python parser with given OCR raw text.
 * @param {string} rawText
 * @param {object} options { timeoutMs?: number, pythonPath?: string }
 * @returns {Promise<{ items: Array, error?: string, durationMs: number, rawStdout: string, rawStderr: string, meta?: object }>}
 */
async function runPythonParser(rawText, options = {}) {
  const start = Date.now();
  const timeoutMs = options.timeoutMs || 10000; // 10s default
  // Try multiple Python executable names and paths
  const possiblePythonPaths = [
    options.pythonPath,
    process.env.PYTHON_PATH,
    '/usr/bin/python3',
    '/usr/bin/python',
    'python3',
    'python',
    'py'
  ].filter(Boolean);
  const pythonPath = possiblePythonPaths[0] || 'python';
  try {
    ensurePythonScriptExists();
  } catch (e) {
    return { items: [], error: e.message, durationMs: Date.now() - start, rawStdout: '', rawStderr: '' };
  }

  // Write temp input
  const { tmpDir, filePath } = writeTempInput(rawText || '');

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    // Pass API key and OCR text as expected by the Python script
    const apiKey = process.env.GOOGLE_API_KEY || '';
    const ocrText = fs.readFileSync(filePath, 'utf8');
    const args = [PY_SCRIPT_RELATIVE, apiKey, ocrText];
    const child = spawn(pythonPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });

    const killTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        cleanup();
        resolve({ items: [], error: `Python parser timeout after ${timeoutMs}ms`, durationMs: Date.now() - start, rawStdout: stdout, rawStderr: stderr });
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(killTimer);
      // Remove temp dir
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
    }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ items: [], error: `Failed to start python: ${err.message}`, durationMs: Date.now() - start, rawStdout: stdout, rawStderr: stderr });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      let parsed = null; let parseError = null; let items = [];
      if (code !== 0) {
        parseError = `Python exited with code ${code}`;
      }
      if (stdout) {
        try {
          // Attempt to find last JSON object in stdout
          const jsonMatch = stdout.match(/\{[\s\S]*\}$/m); // naive greedy last object
          const jsonText = jsonMatch ? jsonMatch[0] : stdout;
          parsed = JSON.parse(jsonText);
          if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed && Array.isArray(parsed.items)) {
            items = parsed.items;
          } else if (parsed && Array.isArray(parsed.parsed_items)) {
            items = parsed.parsed_items;
          }
        } catch (e) {
          parseError = parseError ? `${parseError}; JSON parse failed: ${e.message}` : `JSON parse failed: ${e.message}`;
        }
      }

      resolve({
        items,
        error: parseError || (stderr ? stderr.trim() : undefined),
        durationMs: Date.now() - start,
        rawStdout: stdout,
        rawStderr: stderr,
        meta: parsed && parsed.meta ? parsed.meta : undefined
      });
    });
  });
}

module.exports = { runPythonParser };
