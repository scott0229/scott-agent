// Rename blog #3 title.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const newTitle = '案例解讀：2026/5/11 如果沒有被行權的風險，展期只能賺 $0.9，不如不做';

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET title = '${escape(newTitle)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-title-v2.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
