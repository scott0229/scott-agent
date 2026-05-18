// Merge another pair of intro paragraphs.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<p>注意 +5 是一個<strong>主動選擇</strong> — 不是 roll 必然帶來的副作用。同一個 roll 動作下，可以選同 strike 平移（646→646）、選下調、選大幅上調、甚至選不開新倉。+5 是這些選項之一。</p>

<p>那 +5 / +0.9 對應什麼策略目的？先看每次 roll 有哪些合理選項。</p>`;

const newBlock = `<p>注意 +5 是一個<strong>主動選擇</strong> — 不是 roll 必然帶來的副作用。同一個 roll 動作下，可以選同 strike 平移（646→646）、選下調、選大幅上調、甚至選不開新倉。+5 是這些選項之一。那 +5 / +0.9 對應什麼策略目的？先看每次 roll 有哪些合理選項。</p>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: could not find the block to merge. Aborting.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog-3-merge-p.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
