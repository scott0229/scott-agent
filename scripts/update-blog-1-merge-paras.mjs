// Merge the two paragraphs about "典型的反應過度" + "拉的幅度" into one.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 1;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog1-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '行權價一口氣下拉 6 個點。</p>\n\n<p>問題不在展期本身，而在拉的幅度。';
const newStr = '行權價一口氣下拉 6 個點。問題不在展期本身，而在拉的幅度。';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-1-merge-paras.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/1');
