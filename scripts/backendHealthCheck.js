#!/usr/bin/env node
/**
 * Backend Health Check Script
 * Pings a curated set of critical API endpoints and reports PASS/FAIL with timings.
 * Usage: node scripts/backendHealthCheck.js [baseUrl]
 * Default baseUrl: http://localhost:5000/api
 */
const fetch = require('node-fetch');

const BASE = process.argv[2] || process.env.API_BASE_URL || 'http://localhost:5000/api';

const endpoints = [
  { name: 'Health Root', path: '/health', method: 'GET' },
  { name: 'DB Status', path: '/health/db-status', method: 'GET' },
  { name: 'Inventory Categories (sample)', path: '/inventory-categories', method: 'GET' },
  { name: 'ABC Analysis History', path: '/abc-analysis/history', method: 'GET' },
  { name: 'Minimal Stock Critical Items (sample business=1)', path: '/minimal-stock/critical-items/1', method: 'GET' },
  { name: 'Reorder Suggested Items (sample business=1)', path: '/reorder/suggested-items/1', method: 'GET' },
  { name: 'Usage Records', path: '/usage/records', method: 'GET' },
  { name: 'Stockrepo Header Summary', path: '/stockrepo/header-summary', method: 'GET' }
];

function pad(str, len) { return (str + ' '.repeat(len)).slice(0, len); }

async function check(ep) {
  const url = BASE + ep.path;
  const started = Date.now();
  try {
    const res = await fetch(url, { method: ep.method, timeout: 15000 });
    const ms = Date.now() - started;
    if (!res.ok) {
      const text = await res.text();
      return { name: ep.name, path: ep.path, ok: false, status: res.status, ms, error: text.slice(0,200) };
    }
    // Try to parse json but don't fail health if invalid
    let bodySample = '';
    try {
      const json = await res.json();
      bodySample = JSON.stringify(json).slice(0,120);
    } catch { bodySample = 'Non-JSON or empty'; }
    return { name: ep.name, path: ep.path, ok: true, status: res.status, ms, sample: bodySample };
  } catch (err) {
    const ms = Date.now() - started;
    return { name: ep.name, path: ep.path, ok: false, status: 0, ms, error: err.message };
  }
}

(async () => {
  console.log(`\n🔍 Backend Health Check @ ${BASE}`);
  const results = [];
  for (const ep of endpoints) {
    const r = await check(ep);
    results.push(r);
    if (r.ok) {
      console.log(`✅ ${pad(ep.name,34)} ${pad(ep.method,6)} ${pad(ep.path,40)} ${r.status} ${r.ms}ms`);
    } else {
      console.log(`❌ ${pad(ep.name,34)} ${pad(ep.method,6)} ${pad(ep.path,40)} FAIL ${r.ms}ms :: ${r.status} ${r.error}`);
    }
  }
  const pass = results.filter(r=>r.ok).length;
  const fail = results.length - pass;
  console.log('\nSummary:');
  console.log(`   Pass: ${pass}`);
  console.log(`   Fail: ${fail}`);
  if (fail === 0) {
    console.log('   Overall: ✅ HEALTHY');
    process.exit(0);
  } else {
    console.log('   Overall: ❌ ISSUES DETECTED');
    // Optionally dump failing detail
    results.filter(r=>!r.ok).forEach(r=>{
      console.log(`   - ${r.name} (${r.path}) -> ${r.error || r.status}`);
    });
    process.exit(1);
  }
})();