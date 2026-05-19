// Change comma to full stop after the verdict word in rows 2/3/4.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['不可行，因為此時同價位展期的權利金已幾乎為 0', '不可行。因為此時同價位展期的權利金已幾乎為 0'],
  ['不可行，行權價、股價間的安全距離已足夠大', '不可行。行權價、股價間的安全距離已足夠大'],
  ['可行，用合理的安全距離換合理的展期收入', '可行。用合理的安全距離換合理的展期收入'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 40)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

writeFileSync(sourcePath, updated, 'utf8');
const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-comma-to-period.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
