/**
 * Chạy cả bộ kiểm thử máy chủ:  npm test
 * Chạy một bài:                 node tests/run-all.mjs dot1-pos
 *
 * Mỗi lần chạy dựng lại `data/test.db` từ dữ liệu mẫu rồi bật máy chủ ở cổng 5178.
 * Dữ liệu thật của tiệm (`data/pos.db`) không bị đụng tới — xem chốt chặn trong
 * tests/lib.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer, stopServer, results, serverLog } from './lib.mjs';

const only = process.argv[2];
const dir = path.join(ROOT, 'tests', 'suites');
const suites = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()
  : [];
const chosen = only ? suites.filter((f) => f.startsWith(only)) : suites;

if (!chosen.length) {
  console.log(only ? `Không có bài kiểm thử nào tên "${only}"` : 'Chưa có bài kiểm thử nào trong tests/suites');
  process.exit(only ? 2 : 0);
}

const info = await startServer();
console.log(`Máy chủ thử: ${info.db_file}`);

let crashed = 0;
for (const file of chosen) {
  const mod = await import(path.join(dir, file).replace(/\\/g, '/').replace(/^/, 'file:///'));
  try {
    await mod.default();
  } catch (e) {
    crashed += 1;
    console.log(`\n  CHẠY LỖI ${file}: ${e.message}`);
  }
}

await stopServer();

const { pass, fail, failed } = results();
console.log('\n====================================================');
console.log(`  TỔNG: ${pass} đạt, ${fail} lỗi${crashed ? `, ${crashed} bài chạy lỗi` : ''}`);
if (failed.length) console.log(`  Bài lỗi: ${failed.join(' · ')}`);
console.log('  (dữ liệu thật ở data/pos.db không bị đụng tới)');
console.log('====================================================');
if (fail || crashed) {
  if (/Error|lỗi/i.test(serverLog())) console.log(`\n--- nhật ký máy chủ ---\n${serverLog().slice(-1500)}`);
  process.exit(1);
}
