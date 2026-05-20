// Rewrite the intro paragraph - drop the blog/1, blog/3 cross-reference,
// put trade context up front. Also drop the redundant "看下面這筆 trade：" line
// since the new intro already transitions into the trade card.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<p>接續這個系列 — <a href="/blog/1">blog/1</a> 講 sell put 過度防守（roll down 太多）、<a href="/blog/3">blog/3</a> 講 sell put 過度積極（roll up 但 credit 太少）。這次是 sell call 的「<strong>過度防守</strong>」 — 跟 blog/1 對稱，但代價更實在：這次不是少收 credit，是<strong>真的付錢出去</strong>。</p>

<p>看下面這筆 trade：</p>`;

const newBlock = `<p>COPX 是週期權，帳戶持倉的 SELL 88 CALL 明天就要到期，今天、明天就得展期。當天的股價已經突破行權價 1~2 個點，COPX 持股的成本是 $80.54，當下交易員決定下一個行權價為 $92。我們來分析這筆交易的問題出在哪：</p>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: intro block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-intro.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
