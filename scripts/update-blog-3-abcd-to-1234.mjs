// Renumber the roll-options labels: A/B/C/D → 1/2/3/4 across the table
// rows, the "都不是" bullets, the heading, and the paragraph references.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

// (oldString, newString) pairs. Order doesn't matter as long as each pair is unique.
const replacements = [
  // Table rows
  ['>A. Skip<', '>1. Skip<'],
  ['>B. 平移<', '>2. 平移<'],
  ['>C. 下調<', '>3. 下調<'],
  ['>D. 大幅上調<', '>4. 大幅上調<'],
  // "都不是" bullets
  ['不是 A（Skip）', '不是 1（Skip）'],
  ['不是 B（平移）', '不是 2（平移）'],
  ['不是 C（下調防守）', '不是 3（下調防守）'],
  ['不是 D（真積極）', '不是 4（真積極）'],
  ['比 B 平移大概邊際多', '比 2 平移大概邊際多'],
  // Heading and paragraph
  ['<h3>如果真要積極（選項 D），會是什麼樣子？</h3>', '<h3>如果真要積極（選項 4），會是什麼樣子？</h3>'],
  ['它取了 D 的<strong>風險增加方向</strong>（上拉），但 credit 水平接近 B（平移）',
   '它取了 4 的<strong>風險增加方向</strong>（上拉），但 credit 水平接近 2（平移）'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 60)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Updated ${replacements.length} substrings.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-abcd-to-1234.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
