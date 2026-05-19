// Tighten the red callout: collapse two paragraphs into one punchy line.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 12px;color:#7a1f1f;">它落在 2 跟 3 的<strong>不可行地帶</strong>：strike 動了一點但風險特性沒實質改變、credit 多了一點但遠不夠稱為積極。<strong>既不甘心 Skip，也不敢 commit 到真正積極的位置，做了個假裝在工作的中間態。</strong></p>
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>5 點 + 0.9 — 不是 Skip 也不是 Commit，做了個假裝在工作的微動。</strong></p>
</div>`;

const newBlock = `<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>+5 / +0.9 — 既不 Skip 也不 commit，是「假裝在工作」的微動。</strong></p>
</div>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: callout block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-callout-tighten.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
