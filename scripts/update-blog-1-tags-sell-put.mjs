// Merge "PUT" + "賣方" tags into single "SELL PUT" tag on blog #1.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 1;
const now = Math.floor(Date.now() / 1000);
const newTags = JSON.stringify(['SELL PUT', '展期', '風險管理']);

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET tags = '${escape(newTags)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-1-tags-sell-put.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog');
