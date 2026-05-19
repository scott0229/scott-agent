// Merge the 策略目的 + 取捨 columns into one "說明" column.
// Format: <main text> — <dimmer trade-off text> on one line.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const dim = (s) => `<span style="color:#8a7864;">${s}</span>`;

const replacements = [
  // Drop "取捨" header, rename "策略目的" → "說明"
  [
    `      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">策略目的</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">取捨</th>`,
    `      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">說明</th>`,
  ],
  // Row 1
  [
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">觀望，等更好的入場位置</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">放棄今日 cashflow</td>`,
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">觀望，等更好的入場位置 — ${dim('放棄今日 cashflow')}</td>`,
  ],
  // Row 2
  [
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">維持 risk profile (風險特性)</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">收一點 credit，不冒新風險</td>`,
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">維持 risk profile (風險特性) — ${dim('收一點 credit，不冒新風險')}</td>`,
  ],
  // Row 3
  [
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">為 buffer 付 credit（防守）</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">少收 credit、多買安全距離</td>`,
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">為 buffer 付 credit（防守）— ${dim('少收 credit、多買安全距離')}</td>`,
  ],
  // Row 4 (last, no border-bottom on this row)
  [
    `      <td style="padding:7px 10px;">為明顯多的 credit 放棄 buffer（積極）</td>
      <td style="padding:7px 10px;">真的多收、真的多冒險</td>`,
    `      <td style="padding:7px 10px;">為明顯多的 credit 放棄 buffer（積極）— ${dim('真的多收、真的多冒險')}</td>`,
  ],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: block not found:\n${oldStr.slice(0, 80)}...`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Applied ${replacements.length} replacements.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-merge-cols2.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
