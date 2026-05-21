// Remove the 量化視角 section (h3 + intro + table + 2 paragraphs).
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `
<h3>量化視角</h3>

<p>5/14 trade 當下，原 88 strike 跟新 92 strike 相對於 COPX $89.38：</p>

<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.9rem;background:#fff;color:#3a3025;border-radius:6px;overflow:hidden;">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">Strike</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">vs 現價</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">狀態</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">88（原）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">ITM $1.38</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">-1.5%（在價內）</td></tr>
    <tr><td style="padding:7px 10px;">92（新）</td><td style="padding:7px 10px;">OTM $2.62</td><td style="padding:7px 10px;color:#22a37f;font-weight:600;">+2.9% buffer</td></tr>
  </tbody>
</table>

<p>+4 strike 的效果：把部位從 ITM 推回 OTM，並多塞了 $2.62 的「過剩 cushion」。代價是 -138.5 已實現虧損。換算：每多 1% buffer 平均付了 ~$31。</p>

<p>跟 blog/1 的對稱：blog/1 那筆 sell put roll down 6 點，當時 buffer 已經夠大、根本不需要 defend；這筆 sell call 是 ITM 真的需要 defend，但 defend 的幅度（+4）太大。<strong>兩個都是同類錯誤：過度防守 — 多花權利金 / 多付現金，去買一個比實際需要還多的 cushion。</strong></p>
`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: 量化視角 block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, '\n');
console.log(`Removed ${oldBlock.length} chars.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-remove-quant.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
