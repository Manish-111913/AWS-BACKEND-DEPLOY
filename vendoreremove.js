/**
 * Remove or deactivate a Vendor with dependency-aware cleanup.
 *
 * Usage examples:
 *   node vendoreremove.js --business 1 --id 42 --hard --purge --yes
 *   node vendoreremove.js --business 1 --name "Acme Wholesale" --soft --yes
 *   node vendoreremove.js --business 1 --id 42            # dry-run plan
 */

const path = require('path');
// Load env from backend/.env if present (consistent with config/database.js)
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./config/database');
const { removeVendor, planVendorRemoval, toBool } = require('./services/vendorRemoval');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith('--')) return true; // boolean flag
  return val;
}

async function main() {
  const businessId = parseInt(getArg('--business') || getArg('-b'), 10);
  const vendorIdArg = getArg('--id') || getArg('-i');
  const vendorName = getArg('--name') || getArg('-n');
  const hard = !!getArg('--hard');
  const soft = !!getArg('--soft');
  const purge = !!getArg('--purge');
  const yes = !!getArg('--yes') || !!getArg('--force');

  if (!businessId || (!vendorIdArg && !vendorName)) {
    console.error('Usage: node vendoreremove.js --business <id> (--id <vendor_id> | --name "<vendor_name>") [--soft|--hard] [--purge] [--yes]');
    process.exit(2);
  }

  if (hard && soft) {
    console.error('Specify only one mode: --soft or --hard');
    process.exit(2);
  }

  try {
    const plan = await planVendorRemoval(pool, {
      businessId,
      vendorId: vendorIdArg ? parseInt(vendorIdArg, 10) : undefined,
      vendorName: vendorName || undefined,
      hard: hard && !soft,
      purge: purge,
    });

    console.log('Removal plan:', JSON.stringify(plan, null, 2));

    if (!yes) {
      console.log('Dry run. No changes made. Re-run with --yes to execute.');
      process.exit(0);
    }

    const result = await removeVendor(pool, {
      businessId,
      vendorId: plan.vendor.vendor_id,
      hard: plan.mode === 'hard',
      purge: plan.purge,
      dryRun: false,
    });

    console.log('Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };