// Reduce excessive <strong> highlighting throughout blog #4.
// Keep only: structural bullet labels, callout section headers, numbered list headers.
// Remove all mid-sentence emphasis bolds.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
let content = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // 1) "strike 變化" bullet — drop the inner bold
  { old: '<strong>strike 變化</strong>：88 → 92，<strong>主動上拉 +4，加強防守</strong>',
    new: '<strong>strike 變化</strong>：88 → 92，主動上拉 +4，加強防守' },

  // 2) 淨支出 bullet — drop inner "付 debit" bold
  { old: '<span style="color:#dc2626;font-weight:600;">-138.5</span>（不是收 credit，是<strong>付 debit</strong>）',
    new: '<span style="color:#dc2626;font-weight:600;">-138.5</span>（不是收 credit，是付 debit）' },

  // 3) "付錢展期" paragraph — drop two inline bolds
  { old: '對賣方來說，<strong>付錢展期</strong>是極端的手段，通常代表行權價被突破，而且不想讓正股被指派：5/14 那天 COPX 收 $89.38、<strong>原 88C 已經被突破 1.38 個點</strong>。',
    new: '對賣方來說，付錢展期是極端的手段，通常代表行權價被突破，而且不想讓正股被指派：5/14 那天 COPX 收 $89.38、原 88C 已經被突破 1.38 個點。' },

  // 4) Topic-sentence intro — drop the two preview bolds (the actual section headers appear below)
  { old: '這筆 defend 的問題分兩層：<strong>根本不需要 defend</strong>；<strong>就算要 defend，+4 也是太多</strong>。',
    new: '這筆 defend 的問題分兩層：根本不需要 defend；就算要 defend，+4 也是太多。' },

  // 5) 第一層 paragraph — drop $80.54 / $746 / 被指派從來不是失敗 inline bolds
  { old: '持有 COPX 正股的成本是 <strong>$80.54</strong>。如果 88C 真的被指派（以 $88 賣出 100 股），實現獲利是 ($88 − $80.54) × 100 = <strong>$746</strong>（單股 +9.3%）。對 covered call 策略來說，<strong>被指派從來不是失敗</strong> — 它是策略的 designed outcome 之一。',
    new: '持有 COPX 正股的成本是 $80.54。如果 88C 真的被指派（以 $88 賣出 100 股），實現獲利是 ($88 − $80.54) × 100 = $746（單股 +9.3%）。對 covered call 策略來說，被指派從來不是失敗 — 它是策略的 designed outcome 之一。' },

  // 6) 第二層 paragraph — drop long mid-sentence bolds
  { old: '更關鍵的是看正股的處境：<strong>當正股不是必須留著、本身也沒虧錢時，為了 defend 而吞下 $138.5 已實現虧損本身就過頭</strong> — 這跟「需要把跌破的部位救回來」是完全不同的情境。退一步說，如果真要 defend，<strong>剛好拉過 ITM（+2 到 90）就足夠</strong> — 最低成本、最小負擔。',
    new: '更關鍵的是看正股的處境：當正股不是必須留著、本身也沒虧錢時，為了 defend 而吞下 $138.5 已實現虧損本身就過頭 — 這跟「需要把跌破的部位救回來」是完全不同的情境。退一步說，如果真要 defend，剛好拉過 ITM（+2 到 90）就足夠 — 最低成本、最小負擔。' },

  // 7) Red callout — the whole sentence already gets red bg + red color; drop the inner <strong>
  { old: '<p style="margin:0;font-size:1.05rem;color:#dc2626;"><strong>持股成本 $80.54，被指派出場就是 +9.3% 獲利。硬要 defend 還拉到 +4，是把好結果當成壞結果在處理，多付 $138.5。</strong></p>',
    new: '<p style="margin:0;font-size:1.05rem;color:#dc2626;font-weight:600;">持股成本 $80.54，被指派出場就是 +9.3% 獲利。硬要 defend 還拉到 +4，是把好結果當成壞結果在處理，多付 $138.5。</p>' },

  // 8) "事後的 bonus" paragraph — drop both inline bolds
  { old: '事後的 bonus：隔天 5/15 COPX 重挫到 $83.05，<strong>原 88C 自己回到 OTM、會 worthless expire</strong>。但這是後見之明，trade 時不能假設市場會這樣發展。<strong>真正的 critique 是 ex-ante：根本不該 defend；就算要 defend，+4 也太多。</strong>',
    new: '事後的 bonus：隔天 5/15 COPX 重挫到 $83.05，原 88C 自己回到 OTM、會 worthless expire。但這是後見之明，trade 時不能假設市場會這樣發展。真正的 critique 是 ex-ante：根本不該 defend；就算要 defend，+4 也太多。' },

  // 9) 反駁 #1 — drop "已實現虧損"
  { old: '是用真實現金換的 — 不是 abstract 的「opportunity cost」，是<strong>已實現虧損</strong>。',
    new: '是用真實現金換的 — 不是 abstract 的「opportunity cost」，是已實現虧損。' },

  // 10) 反駁 #2 — drop "用一連串小金額累積成大額虧損"
  { old: '一直靠付錢防守反而是<strong>用一連串小金額累積成大額虧損</strong>。',
    new: '一直靠付錢防守反而是用一連串小金額累積成大額虧損。' },

  // 11) 總結 premise — drop the bolded premise sentence
  { old: '前提：<strong>正股已經有未實現獲利，被 call 走只是換現金、不是虧損</strong>。',
    new: '前提：正股已經有未實現獲利，被 call 走只是換現金、不是虧損。' },

  // 12) 總結 bullet 1 — drop "展期成本為零"
  { old: '<strong>預設做法：讓它被指派</strong>。鎖定正股的獲利 + 已收的 call 權利金，<strong>展期成本為零</strong>。這通常是期望值最高的選擇。',
    new: '<strong>預設做法：讓它被指派</strong>。鎖定正股的獲利 + 已收的 call 權利金，展期成本為零。這通常是期望值最高的選擇。' },

  // 13) 總結 bullet 2 — drop "剛好 OTM"
  { old: '<strong>只有「真的還想長期持有正股」時才展期</strong>。目標是把新 strike 拉到<strong>剛好 OTM</strong>（+1~+2%），讓部位脫離 ITM 就好',
    new: '<strong>只有「真的還想長期持有正股」時才展期</strong>。目標是把新 strike 拉到剛好 OTM（+1~+2%），讓部位脫離 ITM 就好' },

  // 14) 總結 closing question — drop the bolded question
  { old: '下單前先問自己：<strong>「如果被 call 走，我會難過嗎？」</strong> 如果答案是不會',
    new: '下單前先問自己：「如果被 call 走，我會難過嗎？」如果答案是不會' },

  // 15) Final blockquote — drop "一筆一筆把累積的 credit 倒回去"
  { old: '賣方的權利金是慢慢累積的；過度防守的代價是<strong>一筆一筆把累積的 credit 倒回去</strong>。',
    new: '賣方的權利金是慢慢累積的；過度防守的代價是一筆一筆把累積的 credit 倒回去。' },
];

for (const { old, new: n } of replacements) {
  if (!content.includes(old)) {
    console.error('ERROR: substring not found:\n  ' + old.slice(0, 80) + '...');
    process.exit(1);
  }
  content = content.replace(old, n);
}

writeFileSync(sourcePath, content, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(content)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-reduce-bold.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

// Report remaining bold count
const remaining = (content.match(/<strong>/g) || []).length;
console.log(`\n✅ Done. Remaining <strong> tags: ${remaining} (was 37). Refresh https://scott-agent.com/blog/4`);
