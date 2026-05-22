// Rename blog #4 title.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const newTitle = '案例 3：2026/5/14 如果 SELL CALL 的正股已有收益，行權價被打穿時如何應對';

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET title = '${escape(newTitle)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-title-v4.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
