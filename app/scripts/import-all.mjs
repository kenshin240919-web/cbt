// content/*.json(샘플 제외) 전체를 한 SQL로 합친다. 다시 실행해도 같은 결과(바뀐 문항만 새 버전).
// 사용: node scripts/import-all.mjs > out.sql
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = new URL('../content/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'sample-paper.json').sort();
for (const f of files) {
  process.stdout.write(execFileSync('node', [new URL('./import-paper.mjs', import.meta.url).pathname, new URL(f, dir).pathname], { encoding: 'utf8' }));
}
console.error(`imported ${files.length} papers: ${files.join(', ')}`);
