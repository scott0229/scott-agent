// Consolidate the broken-up setup + 逐一檢查 + bullets into a single tight paragraph.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<p>這個情境下，<strong>真正可行的只有 1（Skip）跟 4（大幅上調）</strong>。2 跟 3 因為權利金幾乎為 0、或 buffer 已經足夠大而不適用。看 +5 / +0.9 落在哪一個。</p>

<h3>+5 / +0.9 對應哪個？答案：合理的兩個都不選</h3>

<p>逐一檢查：</p>

<ul>
  <li><strong>不是 1（Skip）</strong> — 不甘心放棄展期 cashflow，硬開了新倉收 +0.9。</li>
  <li><strong>不是 4（大幅上調）</strong> — 沒拉到 ATM 附近能收明顯多 credit 的位置（例如 690P 可收 ~$30）。</li>
</ul>`;

const newBlock = `<h3>+5 / +0.9 對應哪個？答案：合理的兩個都不選</h3>

<p>這個情境下，<strong>真正可行的只有 1（Skip）跟 4（大幅上調）</strong> — 2 跟 3 因為權利金幾乎為 0、或 buffer 已足夠大而不適用。但 trader 的 +5 / +0.9 兩個都不是：<strong>不是 1</strong>（不甘心放棄展期 cashflow，硬開了新倉收 +0.9），<strong>也不是 4</strong>（沒拉到 ATM 附近能收明顯多 credit 的位置，例如 690P 可收 ~$30）。</p>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-consolidate.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
