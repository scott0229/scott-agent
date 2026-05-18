// Merge the two intro paragraphs into one.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldIntro = `<p>5/12 到期的 QQQ 646 sell put 必須展期。但 5/11 收盤 QQQ 已經到 <strong>$713.29</strong>，原 strike 646 被遠遠甩在現價之下約 67 點（<strong>9.4%</strong>）。</p>

<p>展期一定要做 — 問題只剩一個：<strong>新的行權價該怎麼決定？</strong></p>`;

const newIntro = `<p>5/12 到期的 QQQ 646 sell put 必須展期。但 5/11 收盤 QQQ 已經到 <strong>$713.29</strong>，原 strike 646 被遠遠甩在現價之下約 67 點（<strong>9.4%</strong>）。展期一定要做 — 問題只剩一個：<strong>新的行權價該怎麼決定？</strong></p>`;

if (!original.includes(oldIntro)) {
  console.error('ERROR: could not find the intro to merge. Aborting.');
  process.exit(1);
}
const updated = original.replace(oldIntro, newIntro);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog-3-intro2.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
