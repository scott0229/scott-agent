// Move Y-axis price labels from left (x=42, anchor=end) to right (x=705, anchor=start).
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  ['<text x="42" y="56" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">95</text>',
   '<text x="705" y="56" font-size="10" fill="#a89580" text-anchor="start" font-family="sans-serif">95</text>'],
  ['<text x="42" y="101" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">90</text>',
   '<text x="705" y="101" font-size="10" fill="#a89580" text-anchor="start" font-family="sans-serif">90</text>'],
  ['<text x="42" y="147" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">85</text>',
   '<text x="705" y="147" font-size="10" fill="#a89580" text-anchor="start" font-family="sans-serif">85</text>'],
  ['<text x="42" y="192" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">80</text>',
   '<text x="705" y="192" font-size="10" fill="#a89580" text-anchor="start" font-family="sans-serif">80</text>'],
  ['<text x="42" y="238" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">75</text>',
   '<text x="705" y="238" font-size="10" fill="#a89580" text-anchor="start" font-family="sans-serif">75</text>'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 60)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Moved ${replacements.length} Y-axis labels to right.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-yaxis-right.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
