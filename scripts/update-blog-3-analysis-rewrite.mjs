// Rewrite the analysis section after the roll-options table so it lines
// up with the new viability assessment: 1 and 4 are the only viable
// options; 2 (premium ≈ 0) and 3 (buffer already large) are not.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [];

// 1) Transition line + main h3 + bullets + 無人地帶 paragraph + red callout.
const oldBlock1 = `<p>合理的展期應該對應其中一個目的。看 +5 / +0.9 對應哪個。</p>

<h3>+5 / +0.9 對應哪個？答案：都不是</h3>

<p>逐一檢查：</p>

<ul>
  <li><strong>不是 1（Skip）</strong> — 確實開了新倉。</li>
  <li><strong>不是 2（平移）</strong> — strike 動了 +5（buffer 從 9.4% → 8.7%）。</li>
  <li><strong>不是 3（下調防守）</strong> — 方向反過來，是上拉。</li>
  <li><strong>不是 4（真積極）</strong> — 多收的 +0.9（比 2 平移大概邊際多 +0.5）不算「明顯多」。</li>
</ul>

<p>它落在四個合理選項之間的<strong>無人地帶</strong>：strike 動了，但 risk profile 沒實質改變；credit 多了一點，但不足以稱為「積極獲利」。</p>

<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>5 點 + 0.9 — strike 動了，但沒對應任何策略目的。為了拉而拉。</strong></p>
</div>`;

const newBlock1 = `<p>這個情境下，<strong>真正可行的只有 1（Skip）跟 4（大幅上調）</strong>。2 跟 3 因為權利金幾乎為 0、或 buffer 已經足夠大而不適用。看 +5 / +0.9 落在哪一個。</p>

<h3>+5 / +0.9 對應哪個？答案：合理的兩個都不選</h3>

<p>逐一檢查：</p>

<ul>
  <li><strong>不是 1（Skip）</strong> — 不甘心放棄展期 cashflow，硬開了新倉收 +0.9。</li>
  <li><strong>不是 4（大幅上調）</strong> — 沒拉到 ATM 附近能收明顯多 credit 的位置（例如 690P 可收 ~$30）。</li>
</ul>

<p>它落在 2 跟 3 的<strong>不可行地帶</strong>：strike 動了一點但風險特性沒實質改變、credit 多了一點但遠不夠稱為積極。<strong>既不甘心 Skip，也不敢 commit 到真正積極的位置，做了個假裝在工作的中間態。</strong></p>

<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>5 點 + 0.9 — 不是 Skip 也不是 Commit，做了個假裝在工作的微動。</strong></p>
</div>`;

replacements.push([oldBlock1, newBlock1]);

// 2) Last paragraph in the "如果真要積極" section: fix "credit 接近 2（平移）" claim.
replacements.push([
  '<p>+5 / +0.9 的問題：它取了 4 的<strong>風險增加方向</strong>（上拉），但 credit 水平接近 2（平移）。<strong>兩端最差的合成</strong> — 該防守時又往上走，該積極時又下不了重手。</p>',
  '<p>+5 / +0.9 的問題：它取了 4 的<strong>方向</strong>（上拉），但只走了真正 commit 幅度的 <strong>1/30</strong> 左右。<strong>既不徹底 Skip，也不徹底 commit</strong> — 兩邊的好處都拿不到。</p>',
]);

// 3) Inside the 反駁 callout: "+5 點換 +0.5 邊際 credit" is stale (assumes 平移 ≈ 0.4).
replacements.push([
  '這個論點把「動 strike」當成中性決策。實際上每往上動一點都是「放棄 buffer」的選擇 — <strong>+5 點換 +0.5 邊際 credit 是 risk/reward 最差的比例之一</strong>。',
  '這個論點把「動 strike」當成中性決策。實際上每往上動一點都是「放棄 buffer」的選擇 — <strong>+5 點只換到 +0.9 credit，是真正積極部位 (~$30) 的 1/30，risk/reward 比例極差</strong>。',
]);

// 4) Inside the 反駁 callout: "微薄的同 strike credit" no longer applies (in this case 平移 ≈ 0).
replacements.push([
  '真要 cashflow，<strong>要嘛接受微薄的同 strike credit（不冒新風險）</strong>，要嘛 <strong>commit 到真正多收的位置（如 690 那塊）</strong>',
  '真要 cashflow，<strong>要嘛 Skip 等更好入場</strong>，要嘛 <strong>commit 到真正多收的位置（如 690 那塊收 ~$30）</strong>',
]);

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found:\n${oldStr.slice(0, 100)}...`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Applied ${replacements.length} replacements.`);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-analysis-rewrite.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
