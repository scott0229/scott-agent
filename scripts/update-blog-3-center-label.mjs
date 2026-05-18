// Move the big buffer label to the vertical midpoint between the $713.29
// line (y=80) and the $646 line (y=290) → center at y=185.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // Buffer label rect: y 160 -> 171 (center now at y=185)
  ['<rect x="60" y="160" width="160" height="28" fill="#fff" stroke="#22a37f"',
   '<rect x="60" y="171" width="160" height="28" fill="#fff" stroke="#22a37f"'],
  // Buffer label text y: 178 -> 189
  ['<text x="140" y="178" font-size="13" font-weight="700" fill="#22a37f"',
   '<text x="140" y="189" font-size="13" font-weight="700" fill="#22a37f"'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 60)}...`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Updated content: ${updated.length} chars`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-center-label.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
