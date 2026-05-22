// Replace the 5-row trade table in blog #5 with two trade-card boxes,
// matching the visual style used in blog #4 (案例 3).
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 5;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog5-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = `<p>看 5/19–5/20 連續三筆 trade：</p>

<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.9rem;background:#fff;color:#3a3025;border-radius:6px;overflow:hidden;">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">日期</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">動作</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">標的</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">權利金 / 損益</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/19</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">STO（開）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May20 <strong>715C</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">收 $701.3</td></tr>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/20</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">BTC（平）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May20 715C</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#16a34a;font-weight:600;">損益 +$227</td></tr>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/20</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">STO（roll #1）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May21 <strong>714C</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">收 $955.7</td></tr>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/20 <strong>同日</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">BTC（roll #2）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May21 714C</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#dc2626;font-weight:600;">損益 -$933</td></tr>
    <tr><td style="padding:7px 10px;">5/20</td><td style="padding:7px 10px;">STO（roll #2 新部位）</td><td style="padding:7px 10px;">QQQ May21 <strong>717C</strong></td><td style="padding:7px 10px;">收 $1,266.8（持有中）</td></tr>
  </tbody>
</table>`;

const newStr = `<p>5/19 開盤先 STO 一口 QQQ May20'26 715C，收 $701.3 — 這是初始部位。隔天 5/20 一天內做了兩次 roll：</p>

<div style="background:#1a1a1a;color:#f5f1ea;border-radius:8px;padding:14px 18px;margin:20px 0;font-family:Consolas,'Microsoft JhengHei',monospace;font-size:1rem;line-height:1.7;">
  <div style="font-size:0.95rem;color:#c9b89f;margin-bottom:10px;line-height:1.6;">交易時間：2026/5/20 早盤<br>當時 QQQ 約 $705.29（剛開盤）</div>
  <div style="display:inline-block;background:#14361f;color:#7ee0a8;border-left:4px solid #7ee0a8;padding:6px 12px;border-radius:4px;margin-bottom:12px;font-weight:600;font-size:0.95rem;">Roll #1，展期 1，調價 -1，盈虧<span style="color:#7ee0a8;margin-left:4px;font-weight:700;">+$481.4</span></div>
  <div style="padding:2px 0;letter-spacing:0.3px;">-1口 QQQ May20'26 715C</div>
  <div style="padding:2px 0;letter-spacing:0.3px;">+1口 QQQ May21'26 714C</div>
</div>

<div style="background:#1a1a1a;color:#f5f1ea;border-radius:8px;padding:14px 18px;margin:20px 0;font-family:Consolas,'Microsoft JhengHei',monospace;font-size:1rem;line-height:1.7;">
  <div style="font-size:0.95rem;color:#c9b89f;margin-bottom:10px;line-height:1.6;">交易時間：2026/5/20 盤中<br>當時 QQQ 衝高到 ~$713（已突破 714C 的 buffer）</div>
  <div style="display:inline-block;background:#4a2a14;color:#f5b95a;border-left:4px solid #f5b95a;padding:6px 12px;border-radius:4px;margin-bottom:12px;font-weight:600;font-size:0.95rem;">Roll #2，展期 0（同日到期），調價 +3，盈虧<span style="color:#ff8b8b;margin-left:4px;font-weight:700;">-$621.9</span></div>
  <div style="padding:2px 0;letter-spacing:0.3px;">-1口 QQQ May21'26 714C</div>
  <div style="padding:2px 0;letter-spacing:0.3px;">+1口 QQQ May21'26 717C</div>
</div>`;

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-5-roll-boxes.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/5');
