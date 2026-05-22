// Rename blog #1 title — change prefix from 案例解讀 to 案例 1.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 1;
const now = Math.floor(Date.now() / 1000);
const newTitle = '案例 1：2026/5/15 股價當天跌不少，但 SELL PUT 行權價也不要過度反應';

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET title = '${escape(newTitle)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-1-title-v3.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/1');
