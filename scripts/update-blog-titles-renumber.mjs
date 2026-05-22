// Renumber case-study titles to "案例 N：" by blog ID (skipping #2, the video).
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const now = Math.floor(Date.now() / 1000);

const updates = [
  { id: 3, title: '案例 2：2026/5/11 如果沒有被行權的風險，展期只能賺 $0.9，不如不做' },
  { id: 4, title: '案例 3：2026/5/14 如果正股已有收益，SELL CALL 行權價不要過度防守' },
  { id: 5, title: '案例 4：2026/5/20 同日兩次方向相反的 roll — 不是運氣不好，是 strike 太緊' },
];

const escape = (s) => s.replace(/'/g, "''");
const stmts = updates.map(({ id, title }) =>
  `UPDATE blog_posts SET title = '${escape(title)}', updated_at = ${now} WHERE id = ${id};`
).join('\n');

const sqlPath = 'scripts/.tmp-update-blog-titles-renumber.sql';
writeFileSync(sqlPath, stmts, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog');
