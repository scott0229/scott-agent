// Brighten the red callout for dark-mode readability.
// color: #7a1f1f (dark red, invisible on dark bg) → #ff6b6b (light red, works on both)
// bg: rgba(220,38,38,0.06) → rgba(220,38,38,0.12) (more visible tint)
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">\n  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"',
   'background:rgba(220,38,38,0.12);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">\n  <p style="margin:0;font-size:1.05rem;color:#dc2626;"'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 80)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-callout-darkmode.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
