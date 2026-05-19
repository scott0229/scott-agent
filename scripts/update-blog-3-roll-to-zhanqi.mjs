// Replace all "roll" / "Roll" in blog #3 with 展期.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['1DTE → 2DTE 的 roll', '1DTE → 2DTE 的展期'],
  ['不是 roll 必然帶來的副作用', '不是展期必然帶來的副作用'],
  ['同一個 roll 動作下', '同一個展期動作下'],
  ['先看每次 roll 有哪些合理選項', '先看每次展期有哪些合理選項'],
  ['<h3>賣方 roll 的四個合理選項</h3>', '<h3>賣方展期的四個合理選項</h3>'],
  ['每次 roll，strike 怎麼動', '每次展期，strike 怎麼動'],
  ['合理的 roll 應該對應其中一個目的', '合理的展期應該對應其中一個目的'],
  ['Roll 是 base case', '展期是 base case'],
  ['Roll 是必須的', '展期是必須的'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 50)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Replaced ${replacements.length} occurrences.`);

// Sanity: confirm no stray "roll" left (ignoring HTML attribute-ish noise like "stroke-linejoin").
const leftover = updated.match(/\b[Rr]oll\b/g);
if (leftover) {
  console.warn(`Heads up: ${leftover.length} 'roll' tokens still present.`);
}

writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-roll-to-zhanqi.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
