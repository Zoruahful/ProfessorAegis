#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');

const runtimeTargets = [
  'services/database.js',
  'services/benchmark_archive_builder.py',
  'package.json',
];

const retiredCandidates = [
  'database/postgres/backfill_benchmark.js',
  'database/postgres/backfill_non_benchmark.js',
  'services/sqliteRepository.js',
  'professor-aegis.db',
  'professor-aegis.db-shm',
  'professor-aegis.db-wal',
];

const patterns = [
  { name: 'sqlite3 require/import', regex: /sqlite3/g },
  { name: 'runAsync calls', regex: /\brunAsync\s*\(/g },
  { name: 'getAsync calls', regex: /\bgetAsync\s*\(/g },
  { name: 'allAsync calls', regex: /\ballAsync\s*\(/g },
  { name: 'sqliteRepository references', regex: /sqliteRepository/g },
  { name: 'PRAGMA usage', regex: /PRAGMA/g },
];

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

function scanFile(relPath) {
  const full = path.join(projectRoot, relPath);
  if (!fs.existsSync(full)) return { file: relPath, missing: true };
  const text = fs.readFileSync(full, 'utf8');
  const counts = {};
  for (const p of patterns) counts[p.name] = countMatches(text, p.regex);
  return { file: relPath, counts };
}

function summarize(items) {
  return items.reduce((acc, item) => {
    if (item.missing) return acc;
    for (const [k, v] of Object.entries(item.counts)) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});
}

const runtimeResults = runtimeTargets.map(scanFile);
const runtimeSummary = summarize(runtimeResults);

console.log('[SQLite Dependency Check] Runtime Summary:');
console.log(JSON.stringify(runtimeSummary, null, 2));
console.log('');
console.log('[SQLite Dependency Check] Runtime File Breakdown:');
for (const item of runtimeResults) {
  if (item.missing) {
    console.log(`- ${item.file}: missing`);
    continue;
  }
  console.log(`- ${item.file}`);
  for (const [k, v] of Object.entries(item.counts)) console.log(`  ${k}: ${v}`);
}
console.log('');
console.log('[SQLite Dependency Check] Retired Cleanup Candidates:');
for (const relPath of retiredCandidates) {
  const full = path.join(projectRoot, relPath);
  console.log(`- ${relPath}: ${fs.existsSync(full) ? 'present' : 'missing'}`);
}
