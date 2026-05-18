// Add a Chinese gloss to the first "risk profile" mention in the roll-options table.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldCell = '<td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">維持 risk profile</td>';
const newCell = '<td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">維持 risk profile（風險樣貌：指派機率、損益結構等都不變）</td>';

if (!original.includes(oldCell)) {
  console.error('ERROR: cell not found.');
  process.exit(1);
}
const updated = original.replace(oldCell, newCell);
console.log(`Updated content: ${updated.length} chars`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-risk-profile.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
