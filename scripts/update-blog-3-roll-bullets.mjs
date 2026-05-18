// Clarify the close/open bullets so the reader sees these are sell puts.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<li><strong>平倉</strong>：QQQ May12 646P（隔天到期）</li>
  <li><strong>新開</strong>：QQQ May13 651P（後天到期）</li>`;

const newBlock = `<li><strong>買回平倉</strong>：QQQ May12 646P sell put（隔天到期）</li>
  <li><strong>再開新賣</strong>：QQQ May13 651P sell put（後天到期）</li>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: could not find the bullets. Aborting.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-roll-bullets.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
