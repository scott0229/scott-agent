// Brighten the -138.5 P&L color for better dark-mode visibility.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['盈虧<span style="color:#ff6b6b;margin-left:4px;">-138.5</span>',
   '盈虧<span style="color:#ff8b8b;margin-left:4px;font-weight:700;">-138.5</span>'],
  ['<text x="20" y="24" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">COPX ／ 近 10 個交易日收盤 + 5 日均線</text>',
   '<text x="30" y="24" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">COPX ／ 近 10 個交易日收盤 + 5 日均線</text>'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 60)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-loss-color.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
