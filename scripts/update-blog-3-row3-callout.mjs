// 1) Row 3: add the specific 8.7% number to row 3's text.
// 2) Red callout: switch "既不 Skip 也不 commit" to plainer Chinese.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // Row 3
  ['不可行。行權價、股價間的安全距離已足夠大',
   '不可行。行權價、股價間的安全距離 8.7% 已是不合理的大'],
  // Red callout: plain Chinese
  ['<strong>+5 / +0.9 — 既不 Skip 也不 commit，是「假裝在工作」的微動。</strong>',
   '<strong>+5 / +0.9 — 既不退場觀望、也不大幅上拉到位，是「假裝在工作」的微動。</strong>'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 60)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Applied ${replacements.length} replacements.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-row3-callout.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
