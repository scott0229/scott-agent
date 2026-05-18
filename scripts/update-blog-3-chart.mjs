// One-off: strip the 651 strike line + label from blog #3's hero chart,
// keep only the 646 line, tighten the figcaption.
//
// Usage: node scripts/update-blog-3-chart.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

// Read the content we dumped from production earlier.
const sourcePath = 'C:/Users/scott/blog3-content.html';
// Normalise CRLF to LF so our replacement strings line up regardless of how
// the file was last saved.
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
console.log(`Loaded current content: ${original.length} chars`);

// 1. Remove the 651 strike line + label.
const strikeBlock = '<line x1="48" y1="177.6" x2="700" y2="177.6" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>\n    <text x="700" y="172" font-size="11" font-weight="700" fill="#d97706" text-anchor="end" font-family="sans-serif">651 strike (新, +5)</text>\n    ';

if (!original.includes(strikeBlock)) {
  console.error('ERROR: could not find the 651 strike block. Aborting.');
  process.exit(1);
}
let updated = original.replace(strikeBlock, '');

// 2. Tighten figcaption (drop the "→ 新 strike 651" mention).
const oldCaption = '5/11 QQQ 收 $713.29，5 日均線（藍）$699.37 仍處上升趨勢。原 strike 646（buffer 9.4%）→ 新 strike 651（buffer 8.7%）。';
const newCaption = '5/11 QQQ 收 $713.29，5 日均線（藍）$699.37 仍處上升趨勢；原 strike 646 落在現價之下約 9.4%。';
if (!updated.includes(oldCaption)) {
  console.error('ERROR: could not find the original figcaption. Aborting.');
  process.exit(1);
}
updated = updated.replace(oldCaption, newCaption);

console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);

// Write back the cleaned content to the source path so we have a record.
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog-3-chart.sql';
writeFileSync(sqlPath, sql, 'utf8');
console.log(`SQL written to ${sqlPath}`);

const dbs = ['scott-agent-production', 'scott-agent-scott-production'];
for (const db of dbs) {
  console.log(`\n--- Updating ${db} ---`);
  try {
    execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`Update on ${db} failed`);
    process.exit(1);
  }
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
