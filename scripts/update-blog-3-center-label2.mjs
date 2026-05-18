// Move the big buffer label to the midpoint between $713.29 (y=80)
// and $651 (y=200) → center at y=140.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['<rect x="60" y="171" width="160" height="28" fill="#fff" stroke="#22a37f"',
   '<rect x="60" y="126" width="160" height="28" fill="#fff" stroke="#22a37f"'],
  ['<text x="140" y="189" font-size="13" font-weight="700" fill="#22a37f"',
   '<text x="140" y="144" font-size="13" font-weight="700" fill="#22a37f"'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found.`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

writeFileSync(sourcePath, updated, 'utf8');
const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-center-label2.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
