// Trim excess <strong> emphasis in prose paragraphs.
// Keep bullet labels, table headers, callout punchlines, key first-mention.
// Remove number-only bolds, parallel "不是 X" repeats, sub-phrase bolds.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // Intro (line 36): drop $713.29 and 9.4% number bolds. Keep the rhetorical question bold.
  ['但 5/11 收盤 QQQ 已經到 <strong>$713.29</strong>，原 strike 646 被遠遠甩在現價之下約 67 點（<strong>9.4%</strong>）。',
   '但 5/11 收盤 QQQ 已經到 $713.29，原 strike 646 被遠遠甩在現價之下約 67 點（9.4%）。'],

  // Trade-detail bullet (line 53): drop "主動上拉 +5" bold (keep bullet label only).
  ['<li><strong>strike 變化</strong>：646 → 651，<strong>主動上拉 +5</strong></li>',
   '<li><strong>strike 變化</strong>：646 → 651，主動上拉 +5</li>'],

  // Analysis paragraph (line 117): keep the main claim bold, drop the parallel "不是 X" bolds.
  ['但 trader 的 +5 / +0.9 兩個都不是：<strong>不是 1</strong>（不甘心放棄展期 cashflow，硬開了新倉收 +0.9），<strong>也不是 4</strong>（沒拉到 ATM 附近能收明顯多 credit 的位置，例如 690P 可收 ~$30）。',
   '但 trader 的 +5 / +0.9 兩個都不是：不是 1（不甘心放棄展期 cashflow，硬開了新倉收 +0.9），也不是 4（沒拉到 ATM 附近能收明顯多 credit 的位置，例如 690P 可收 ~$30）。'],

  // "如果真要積極" paragraph (line 125): drop the 3 number bolds.
  ['strike 大概要拉到接近 <strong>$690</strong>（距現價約 3.2% buffer）。在這個點位，2DTE sell put 大約可以收到 <strong>~$30/口的 net credit</strong>，是現在 +0.9 的 <strong>30 倍以上</strong>。',
   'strike 大概要拉到接近 $690（距現價約 3.2% buffer）。在這個點位，2DTE sell put 大約可以收到 ~$30/口的 net credit，是現在 +0.9 的 30 倍以上。'],

  // Closing analysis paragraph (line 129): drop "方向" and "1/30" sub-bolds, keep conclusion.
  ['它取了 4 的<strong>方向</strong>（上拉），但只走了真正 commit 幅度的 <strong>1/30</strong> 左右。<strong>既不徹底 Skip，也不徹底 commit</strong>',
   '它取了 4 的方向（上拉），但只走了真正 commit 幅度的 1/30 左右。<strong>既不徹底 Skip，也不徹底 commit</strong>'],

  // 反駁 callout para 1 (line 134): trim long bold to just the punchline phrase.
  ['這個論點把「動 strike」當成中性決策。實際上每往上動一點都是「放棄 buffer」的選擇 — <strong>+5 點只換到 +0.9 credit，是真正積極部位 (~$30) 的 1/30，風險回報比例極差</strong>。',
   '這個論點把「動 strike」當成中性決策。實際上每往上動一點都是「放棄 buffer」的選擇 — +5 點只換到 +0.9 credit，是真正積極部位 (~$30) 的 1/30，<strong>風險回報比例極差</strong>。'],

  // 反駁 callout para 2 (line 135): drop the two parallel bolds in "要嘛 X，要嘛 Y".
  ['真要 cashflow，<strong>要嘛 Skip 等更好入場</strong>，要嘛 <strong>commit 到真正多收的位置（如 690 那塊收 ~$30）</strong>。',
   '真要 cashflow，要嘛 Skip 等更好入場，要嘛 commit 到真正多收的位置（如 690 那塊收 ~$30）。'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 80)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Applied ${replacements.length} replacements.`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-reduce-bold.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
