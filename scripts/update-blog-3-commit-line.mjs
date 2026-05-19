// Rewrite the "$30 credit..." paragraph tail.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '這時 buffer 從 9.4% → 3.2%（縮 6.2 pp，是「真的多承擔風險」），credit 也對應地多收 30x。這是 commit，不是 noise。';
const newStr = '這時 buffer 從 9.4% → 3.2%（縮 6.2%，是真的多承擔風險），況且 3.2% buffer 也足夠多。credit 也對應地多收 30 鎂。';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-commit-line.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
