// Widen viewBox + background rect to add ~40px right padding (Y-axis labels were right against the edge).
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="COPX 近 10 個交易日走勢與 5 日均線"',
   'viewBox="0 0 760 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="COPX 近 10 個交易日走勢與 5 日均線"'],
  ['<rect x="0" y="0" width="720" height="280" fill="#fbf6ef" rx="10"/>',
   '<rect x="0" y="0" width="760" height="280" fill="#fbf6ef" rx="10"/>'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 80)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Applied ${replacements.length} replacements.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-right-padding.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
