// One-off script: update blog/3 title.
// Usage: node scripts/update-blog-3-title.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const newTitle = '案例解讀：2026/5/11 展期只賺 0.9？請想想展期的目的。';
const now = Math.floor(Date.now() / 1000);
const escape = (s) => s.replace(/'/g, "''");

const sql = `UPDATE blog_posts SET
  title = '${escape(newTitle)}',
  updated_at = ${now}
WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog.sql';
writeFileSync(sqlPath, sql, 'utf8');
console.log(`SQL written to ${sqlPath} (${sql.length} bytes)`);

const dbs = ['scott-agent-production', 'scott-agent-scott-production'];
for (const db of dbs) {
  console.log(`\n--- Updating ${db} ---`);
  try {
    execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`Update on ${db} failed`);
    process.exit(1);
  }
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
