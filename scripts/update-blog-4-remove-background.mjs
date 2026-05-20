// One-off script: remove the 「背景：COPX 過去一個月的劇烈波動」 section from blog/4.
// Usage: node scripts/update-blog-4-remove-background.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);

// Exact block to remove (header + intro paragraph + 4 bullets + transition paragraph + trailing blank line).
const removeBlock = `<h3>背景：COPX 過去一個月的劇烈波動</h3>

<p>看上面那張圖，過去 20 個交易日 COPX 走了一個劇烈的 V 型再倒 V：</p>

<ul>
  <li><strong>4/20–5/4</strong>：COPX 從 $86 一路跌到 $76（-12%） — 88C 遠在 OTM、超級安全</li>
  <li><strong>5/4–5/13</strong>：突然反彈，9 個交易日從 $76 衝到 <strong>$91.91</strong>（+20%） — 88C 被打進 ITM 約 $4</li>
  <li><strong>5/13–5/14</strong>：開始拉回到 $89.38 — 但 88C 仍 ITM $1.38</li>
  <li><strong>（5/15 隔日後續）</strong>：COPX 又重挫到 $83.05 — 88C 重新跌回 OTM</li>
</ul>

<p>這位交易者就是在 5/14 這個 ITM $1.38 的情境下決定 roll up + roll out：strike +4、到期 +5 個 trading days，付 -138.5。</p>

`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `UPDATE blog_posts SET
  content = REPLACE(content, '${escape(removeBlock)}', ''),
  updated_at = ${now}
WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog.sql';
writeFileSync(sqlPath, sql, 'utf8');
console.log(`SQL written to ${sqlPath} (${sql.length} bytes)`);

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

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
