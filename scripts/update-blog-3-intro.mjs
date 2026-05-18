// One-off: replace the opening two paragraphs of blog #3 with a tighter
// background setup. Drops the blog/1 cross-link and the "對稱的對立面" framing.
//
// Usage: node scripts/update-blog-3-intro.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
console.log(`Loaded current content: ${original.length} chars`);

const oldIntro = `<p>接續 <a href="/blog/1">前一篇 5/15 的討論</a> — 那篇談的是「<strong>過度防守</strong>」（roll down 太多、反應過度）。這次看一筆對稱的對立面：strike 不是往下拉，而是<strong>往上拉</strong>，但只多收 +0.9。</p>

<p>重點不在「該不該 roll」 — 賣方 cashflow 策略下，roll 是 base case、必須做。重點在<strong>「strike 怎麼移」是另一個獨立決策</strong>，而這個決策只在有明確目的時才該做。</p>`;

const newIntro = `<p>5/12 到期的 QQQ 646 sell put 必須展期。但 5/11 收盤 QQQ 已經到 <strong>$713.29</strong>，原 strike 646 被遠遠甩在現價之下約 67 點（<strong>9.4%</strong>）。</p>

<p>展期一定要做 — 問題只剩一個：<strong>新的行權價該怎麼決定？</strong></p>`;

if (!original.includes(oldIntro)) {
  console.error('ERROR: could not find the original intro. Aborting.');
  process.exit(1);
}
const updated = original.replace(oldIntro, newIntro);

console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog-3-intro.sql';
writeFileSync(sqlPath, sql, 'utf8');

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
