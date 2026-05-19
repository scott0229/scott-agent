// One-off script: add color:#3a3025 to the four-option table on blog/3 so body cells stay readable in dark mode.
// Usage: node scripts/update-blog-3-table-dark-mode.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sql = `UPDATE blog_posts SET
  content = REPLACE(content, 'background:#fff;border-radius:6px;overflow:hidden;', 'background:#fff;color:#3a3025;border-radius:6px;overflow:hidden;'),
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
