// One-off script: move the 717 strike label on blog/5 chart from right-side to left-side,
// so it doesn't crowd against the 714 strike label.
// Usage: node scripts/update-blog-5-strike-label-left.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 5;
const now = Math.floor(Date.now() / 1000);

const oldLabel = `<text x="700" y="74" font-size="11" font-weight="700" fill="#d97706" text-anchor="end" font-family="sans-serif">717 strike (新)</text>`;
const newLabel = `<text x="52" y="78" font-size="11" font-weight="700" fill="#d97706" text-anchor="start" font-family="sans-serif">717 strike (新)</text>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `UPDATE blog_posts SET
  content = REPLACE(content, '${escape(oldLabel)}', '${escape(newLabel)}'),
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

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/5');
