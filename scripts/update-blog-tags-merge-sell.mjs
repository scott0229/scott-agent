// Merge PUT/CALL + 賣方 → SELL PUT / SELL CALL across blogs 3, 4, 5.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const now = Math.floor(Date.now() / 1000);

const updates = [
  { id: 3, tags: ['SELL PUT',  '展期', '風險管理'] },
  { id: 4, tags: ['SELL CALL', '展期', '風險管理'] },
  { id: 5, tags: ['SELL CALL', '展期', '風險管理'] },
];

const escape = (s) => s.replace(/'/g, "''");
const stmts = updates.map(({ id, tags }) =>
  `UPDATE blog_posts SET tags = '${escape(JSON.stringify(tags))}', updated_at = ${now} WHERE id = ${id};`
).join('\n');

const sqlPath = 'scripts/.tmp-update-blog-tags-merge-sell.sql';
writeFileSync(sqlPath, stmts, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog');
