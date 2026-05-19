// Remove the h3 heading + intro paragraph above the roll-options table.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<h3>賣方展期的四個合理選項</h3>

<p>每次展期，strike 怎麼動其實有四個明確選項，每一個對應一個清楚的策略目的：</p>

`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, '');
console.log(`Removed ${oldBlock.length} chars.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-remove-h3.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
