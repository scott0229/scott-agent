// Merge the 選項 + 動作 columns of the roll-options table into one cell.
// Format: <strong>X. label</strong> — action description.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // Drop the "動作" header cell.
  [
    `      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">選項</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">動作</th>`,
    `      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">選項</th>`,
  ],
  // Row 1: Skip
  [
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;font-weight:600;">1. Skip</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">不開新倉</td>`,
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;"><strong>1. Skip</strong> — 不開新倉</td>`,
  ],
  // Row 2: 平移
  [
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;font-weight:600;">2. 平移</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">同 strike（646→646）</td>`,
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;"><strong>2. 平移</strong> — 同 strike（646→646）</td>`,
  ],
  // Row 3: 下調
  [
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;font-weight:600;">3. 下調</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">strike 拉低（646→640）</td>`,
    `      <td style="padding:7px 10px;border-bottom:1px solid #f0e8de;"><strong>3. 下調</strong> — strike 拉低(646→640)</td>`,
  ],
  // Row 4: 大幅上調 (last row, no border-bottom)
  [
    `      <td style="padding:7px 10px;font-weight:600;">4. 大幅上調</td>
      <td style="padding:7px 10px;">strike 接近 ATM（646→690+）</td>`,
    `      <td style="padding:7px 10px;"><strong>4. 大幅上調</strong> — strike 接近 ATM（646→690+）</td>`,
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
const sqlPath = 'scripts/.tmp-update-blog-3-merge-cols.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
