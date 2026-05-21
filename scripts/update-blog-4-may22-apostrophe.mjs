// "May22" → "May'22" for the 3 standalone occurrences (not the formal "May22'26" ticker).
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
let content = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  { old: '新開</strong>：COPX May22 92C', new: '新開</strong>：COPX May\'22 92C' },
  { old: 'May15 → May22，展期一週', new: 'May15 → May\'22，展期一週' },
  { old: '新開 92C May22 雖然收到一些權利金', new: '新開 92C May\'22 雖然收到一些權利金' },
];

for (const { old, new: n } of replacements) {
  if (!content.includes(old)) {
    console.error('ERROR: substring not found: ' + old);
    process.exit(1);
  }
  content = content.replace(old, n);
}

writeFileSync(sourcePath, content, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(content)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-may22-apostrophe.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
