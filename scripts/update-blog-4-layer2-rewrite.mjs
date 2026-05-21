// Strengthen the layer-2 argument by linking back to the stock situation.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '<p>對一個只剩 5 個 trading days 的短期 sell call 來說，<strong>+2.9% buffer 是過度的</strong>。每多 1 個 strike point，付出的成本明顯放大 — 拉到 +4 比拉到 +2 大概多付 50–80%。</p>';
const newStr = '<p>更關鍵的是看正股的處境：<strong>當正股不是必須留著、本身也沒虧錢時，為了 defend 而吞下 $138.5 已實現虧損本身就過頭</strong> — 這跟「需要把跌破的部位救回來」是完全不同的情境。退一步說，如果真要 defend，<strong>剛好拉過 ITM（+2 到 90）就足夠</strong> — 最低成本、最小負擔。每多 1 個 strike point，付出的成本明顯放大 — 拉到 +4 比拉到 +2 大概多付 50–80%。對只剩 5 個 trading days 的短期 sell call，多塞的 strike points 換來的 cushion 根本用不到（時間衰減快、IV 也會自動回落）。</p>';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-layer2-rewrite.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
