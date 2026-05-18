// Tweak the contract notation: May12 646P → May'12 646.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

let updated = original
  .replace('QQQ May12 646P sell put', `QQQ May'12 646 sell put`)
  .replace('QQQ May13 651P sell put', `QQQ May'13 651 sell put`);

if (updated === original) {
  console.error('ERROR: no replacements applied. Aborting.');
  process.exit(1);
}
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-bullet-fmt.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
