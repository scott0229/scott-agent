// Make figcaptions more readable: darker color, slightly bigger, no italic.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStyle = 'style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;"';
const newStyle = 'style="text-align:center;color:#5a4a35;font-size:0.9rem;margin-top:10px;"';

// There are exactly 2 figcaptions with this style in blog #3.
let updated = original.split(oldStyle).join(newStyle);
const replacedCount = original.split(oldStyle).length - 1;
console.log(`Replaced ${replacedCount} occurrences.`);
if (replacedCount === 0) {
  console.error('ERROR: no replacements applied.');
  process.exit(1);
}

writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-figcaption.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
