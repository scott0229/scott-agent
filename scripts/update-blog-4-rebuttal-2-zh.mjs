// Rewrite point 2 of the 反駁 callout in plainer Chinese.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = '<strong>2. 短天期 option，cushion 邊際效用遞減快。</strong>5 個 trading days 的時間衰減夠快、IV 也會自己回落。0.5–1% 的 OTM buffer 在 5 天內被吃掉的機率不高；硬要拉到 3%+ 是過度反應。如果真的怕 COPX 再衝到 $92+，那不如平倉認賠、不開新部位 — 一直 defending 反而是<strong>用一連串小額付出累積大額虧損</strong>。';
const newStr = '<strong>2. 短天期賣方部位，多買的安全距離效用快速遞減。</strong>到期前只剩 5 天，時間衰減夠快、波動率也會自然回落 — 0.5~1% 的安全距離通常就夠了，硬拉到 3% 以上是過度反應。如果真的擔心 COPX 再衝到 $92 以上，比較合理的做法是直接平倉、不開新部位 — 一直靠付錢防守反而是<strong>用一連串小金額累積成大額虧損</strong>。';

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-rebuttal-2-zh.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
