#!/usr/bin/env node
/**
 * Backfill invoice_reference for InventoryBatches where it's empty.
 *
 * Rules:
 * - Skip rows where invoice_reference is already set (non-empty after trim).
 * - Generate a code similar to StockInForm: PREFIX-DDMM-####
 *   - PREFIX: first 4 letters of inventory item name (A-Z only), padded with X, uppercased.
 *   - DDMM: from received_date if present, else created_at date.
 *   - ####: sequential per PREFIX+DDMM in processing order (respect existing suffixes to continue sequence).
 *
 * Usage:
 *   node scripts/backfill-invoice-reference.js [--yes] [--business <id>] [--limit <n>]
 *   - --yes        Apply updates (default is dry-run)
 *   - --business   Limit to a specific business_id (optional)
 *   - --limit      Limit number of updates applied/planned (optional)
 */

const path = require('path');
const { pool } = require('../config/database');

function parseArgs(argv) {
  const args = { yes: false, business: null, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '--force') args.yes = true;
    else if (a === '--business' && argv[i + 1]) { args.business = parseInt(argv[++i], 10) || null; }
    else if (a === '--limit' && argv[i + 1]) { args.limit = parseInt(argv[++i], 10) || null; }
  }
  return args;
}

function makePrefix(itemName) {
  const letters = String(itemName || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  return letters;
}

function ddmm(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}${month}`;
}

async function main() {
  const { yes, business, limit } = parseArgs(process.argv);
  console.log(`Backfill invoice_reference ${yes ? '(APPLY)' : '(DRY-RUN)'} ${business ? `for business ${business}` : '(all businesses)'}${limit ? `, limit ${limit}` : ''}`);

  const client = await pool.connect();
  try {
    const where = business ? 'WHERE ii.business_id = $1' : '';
    const params = business ? [business] : [];

    const rowsSql = `
      SELECT 
        ib.batch_id,
        ib.item_id,
        ib.invoice_reference,
        ib.received_date,
        ib.created_at,
        ii.name AS item_name
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      ${where}
      ORDER BY ii.item_id, COALESCE(ib.received_date, ib.created_at::date), ib.created_at, ib.batch_id
    `;
    const { rows } = await client.query(rowsSql, params);
    console.log(`Loaded ${rows.length} batch rows`);

    // Track counters per prefix-date and used codes to avoid duplicates
    const counters = new Map(); // key: `${prefix}-${ddmm}` -> next number
    const used = new Set();

    // First pass: register existing invoice_reference to seed counters and used set
    for (const r of rows) {
      const date = r.received_date ? new Date(r.received_date) : new Date(r.created_at);
      const prefix = makePrefix(r.item_name);
      const dateStr = ddmm(date);
      const key = `${prefix}-${dateStr}`;
      const inv = (r.invoice_reference || '').trim();
      if (!inv) continue;
      used.add(inv);
      // If matches our pattern, advance counter baseline
      const m = inv.match(new RegExp(`^${prefix}-${dateStr}-(\\d{1,4})$`));
      if (m) {
        const num = parseInt(m[1], 10) || 0;
        const next = Math.max((counters.get(key) || 0), num);
        counters.set(key, next);
      }
    }

    const updates = [];
    for (const r of rows) {
      const existing = (r.invoice_reference || '').trim();
      if (existing) continue; // skip per requirement

      const date = r.received_date ? new Date(r.received_date) : new Date(r.created_at);
      const prefix = makePrefix(r.item_name);
      const dateStr = ddmm(date);
      const key = `${prefix}-${dateStr}`;

      // Determine next sequence
      let current = (counters.get(key) || 0);
      let next = current + 1;
      let code = `${key}-${String(next).padStart(4, '0')}`;
      // Ensure uniqueness if something else used this number
      while (used.has(code)) {
        next += 1;
        code = `${key}-${String(next).padStart(4, '0')}`;
      }

      counters.set(key, next);
      used.add(code);

      updates.push({ batch_id: r.batch_id, code, item_name: r.item_name, date: dateStr });
      if (limit && updates.length >= limit) break;
    }

    if (updates.length === 0) {
      console.log('Nothing to update.');
      return;
    }

    console.log(`Planned updates: ${updates.length}`);
    for (const u of updates.slice(0, 25)) {
      console.log(`  batch_id=${u.batch_id} -> invoice_reference=${u.code} (${u.item_name}, ${u.date})`);
    }
    if (updates.length > 25) console.log(`  ... and ${updates.length - 25} more`);

    if (!yes) {
      console.log('Dry-run complete. Re-run with --yes to apply.');
      return;
    }

    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        'UPDATE InventoryBatches SET invoice_reference = $1, updated_at = NOW() WHERE batch_id = $2 AND (invoice_reference IS NULL OR TRIM(invoice_reference) = \'\')',
        [u.code, u.batch_id]
      );
    }
    await client.query('COMMIT');
    console.log(`Applied ${updates.length} updates.`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    // End the pool so Node can exit when used as a one-off script
    try { await pool.end(); } catch {}
  }
}

main();
