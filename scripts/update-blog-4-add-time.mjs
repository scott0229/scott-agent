// Add trade timestamp (5/14 10:12) at the top of the trade card.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

// Anchor: the opening of the trade card div.
const oldStr = `<div style="background:#1a1a1a;color:#f5f1ea;border-radius:8px;padding:14px 18px;margin:20px 0;font-family:Consolas,'Microsoft JhengHei',monospace;font-size:1rem;line-height:1.7;">
  <div style="display:inline-block;background:#4a2a14;color:#f5b95a;border-left:4px solid #f5b95a;padding:6px 12px;border-radius:4px;margin-bottom:12px;font-weight:600;font-size:0.95rem;">展期 5，調價 +4，盈虧<span style="color:#ff6b6b;margin-left:4px;">-138.5</span></div>`;

const newStr = `<div style="background:#1a1a1a;color:#f5f1ea;border-radius:8px;padding:14px 18px;margin:20px 0;font-family:Consolas,'Microsoft JhengHei',monospace;font-size:1rem;line-height:1.7;">
  <div style="font-size:0.85rem;color:#8a7864;margin-bottom:10px;">2026/5/14 10:12 AM</div>
  <div style="display:inline-block;background:#4a2a14;color:#f5b95a;border-left:4px solid #f5b95a;padding:6px 12px;border-radius:4px;margin-bottom:12px;font-weight:600;font-size:0.95rem;">展期 5，調價 +4，盈虧<span style="color:#ff6b6b;margin-left:4px;">-138.5</span></div>`;

if (!original.includes(oldStr)) {
  console.error('ERROR: trade card opening not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-add-time.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
