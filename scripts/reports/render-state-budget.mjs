import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// The single canonical report now uses the same editorial data for web and PDF.
// PDF generation is offline; ReportLab is pinned in requirements-public-spending.txt.
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) {
  throw new Error('Usage: node scripts/reports/render-state-budget.mjs [--check]');
}
const root = resolve(import.meta.dirname, '../..');
execFileSync(process.env.PYTHON ?? 'python3', [resolve(root, 'scripts/reports/build_state_budget_reader.py'), ...args], {
  cwd: root, stdio: 'inherit',
});
