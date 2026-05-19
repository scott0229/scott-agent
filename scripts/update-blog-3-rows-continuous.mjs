// Convert rows 1, 3, 4 to the same continuous-sentence format as row 2.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // Row 1
  ['可行。觀望、等跌多一點再入場 — <span style="color:#8a7864;">放棄展期現金流</span>',
   '可行。觀望、等跌多一點再入場，放棄展期現金流'],
  // Row 3
  ['為 buffer 付 credit（防守）— <span style="color:#8a7864;">少收 credit、多買安全距離</span>',
   '為 buffer 付 credit（防守），少收 credit、多買安全距離'],
  // Row 4
  ['為明顯多的 credit 放棄 buffer（積極）— <span style="color:#8a7864;">真的多收、真的多冒險</span>',
   '為明顯多的 credit 放棄 buffer（積極），真的多收、真的多冒險'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 60)}...`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Converted ${replacements.length} rows.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-rows-continuous.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
