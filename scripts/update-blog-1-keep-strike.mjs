// Reword the "維持行權價不動" bullet — plainer language + add 2.4% buffer figure.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 1;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog1-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '<strong>維持行權價不動</strong>：新單繼續賣 692P。原 strike 在合理距離，<strong>權利金收最多</strong>，賭股價不再續跌。';
const newStr = '<strong>維持價位不動</strong>：繼續賣 692P。原價位在合理距離 2.4%，<strong>權利金收最多</strong>，賭股價不再續跌。';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-1-keep-strike.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/1');
