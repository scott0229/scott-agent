// Merge "真的擔心..." paragraph into the preceding callout paragraph.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 1;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog1-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '5/15 當天就被擊穿到 692 之下的機率本來就非常低。</p>\n</div>\n\n<p>真的擔心，<em>少量地</em>往下調是合理的（例如 1-2 點），但一次拉 6 個點，明顯是「為了完全消除恐懼」，不是「為了風險管理」。</p>';
const newStr = '5/15 當天就被擊穿到 692 之下的機率本來就非常低。真的擔心，<em>少量地</em>往下調是合理的（例如 1-2 點），但一次拉 6 個點，明顯是「為了完全消除恐懼」，不是「為了風險管理」。</p>\n</div>';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-1-merge-fear-para.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/1');
