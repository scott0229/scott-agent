// Rewrite the 總結 callout — remove the "預設是平移" assumption that conflicts
// with the case where 平移 has ≈ 0 premium.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `  <p style="margin:6px 0 8px;">展期是基本動作。<strong>預設是平移</strong>（同行權價，不冒新風險就收權利金）。要脫離預設，每個方向都該有明確目的：</p>
  <ul style="margin:6px 0 10px;padding-left:1.4em;">
    <li style="margin:6px 0;"><strong>想防守</strong> → 下調 strike，買更多 buffer。</li>
    <li style="margin:6px 0;"><strong>想積極</strong> → 大幅上調 strike，要看到<strong>明顯多的</strong>展期收益（例如 30x，不是 +0.5）。</li>
    <li style="margin:6px 0;"><strong>都不合理</strong> → Skip，今日不開新倉。</li>
  </ul>
  <p style="margin:8px 0 0;">下單前問自己：<strong>「這次 strike 動 X 點，對應的是 4 個目的哪一個？」答不出來 → 別動 strike，就用平移。</strong></p>`;

const newBlock = `  <p style="margin:6px 0 8px;">展期時 strike 怎麼動，<strong>每個動作都該對應一個明確目的</strong>：</p>
  <ul style="margin:6px 0 10px;padding-left:1.4em;">
    <li style="margin:6px 0;"><strong>維持風險收益不變</strong> → 平移（同行權價）— 前提是平移權利金還夠多。</li>
    <li style="margin:6px 0;"><strong>想防守</strong> → 下調 strike，買更多 buffer — 前提是現有 buffer 真的不夠。</li>
    <li style="margin:6px 0;"><strong>想積極</strong> → 大幅上調 strike，要看到<strong>明顯多的</strong>展期收益（例如 30x，不是 +0.5）。</li>
    <li style="margin:6px 0;"><strong>都不合理</strong> → Skip，今日不開新倉。</li>
  </ul>
  <p style="margin:8px 0 0;">下單前問自己：<strong>「這次 strike 怎麼動，對應的目的是什麼？」答不出來就別硬開倉。</strong></p>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: summary callout block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-summary-rewrite.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
