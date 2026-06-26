const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

const checks = [
  { label: 'services/database.js', path: path.join(root, 'services', 'database.js'), expect: 'present' },
  { label: 'database/postgres/client.js', path: path.join(root, 'database', 'postgres', 'client.js'), expect: 'present' },
  { label: 'services/sqliteRepository.js', path: path.join(root, 'services', 'sqliteRepository.js'), expect: 'missing' },
  { label: 'professor-aegis.db', path: path.join(root, 'professor-aegis.db'), expect: 'missing' },
  { label: 'professor-aegis.db-shm', path: path.join(root, 'professor-aegis.db-shm'), expect: 'missing' },
  { label: 'professor-aegis.db-wal', path: path.join(root, 'professor-aegis.db-wal'), expect: 'missing' },
  { label: 'database/postgres/backfill_benchmark.js', path: path.join(root, 'database', 'postgres', 'backfill_benchmark.js'), expect: 'missing' },
  { label: 'database/postgres/backfill_non_benchmark.js', path: path.join(root, 'database', 'postgres', 'backfill_non_benchmark.js'), expect: 'missing' },
];

const results = checks.map((item) => {
  const exists = fs.existsSync(item.path);
  const status = item.expect === 'present' ? exists : !exists;
  return {
    label: item.label,
    expected: item.expect,
    actual: exists ? 'present' : 'missing',
    ok: status,
  };
});

const failed = results.filter((row) => !row.ok);
console.log('[PostgreSQL Final Audit] Summary:');
console.log(JSON.stringify({
  passed: failed.length === 0,
  checked: results.length,
  failed: failed.length,
}, null, 2));
console.log('\n[PostgreSQL Final Audit] File Checks:');
for (const row of results) {
  console.log(`- ${row.label}: expected=${row.expected}, actual=${row.actual}, ok=${row.ok}`);
}
if (failed.length) {
  process.exitCode = 1;
}
