// Rewrite the short-DTE / theta / IV explanation in plainer terms.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '到期前只剩 5 天，時間衰減夠快、波動率也會自然回落 — 0.5~1% 的安全距離通常就夠了，硬拉到 3% 以上是過度反應。';
const newStr = '到期前只剩 5 天的時候，有兩股力量會自動幫賣方：(1) 賣出的 call 會因為時間越來越接近到期，價值快速縮水；(2) 一波恐慌過後，市場的波動率（IV）通常會自動降下來、選擇權的價格也會跟著掉。所以新行權價只要設在比現價高 0.5~1% 的位置，多半就足以撐到到期變成 worthless；硬拉到 3% 以上，等於是花現金去防一個不太會發生的風險，是過度反應。';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-short-dte-explain.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
