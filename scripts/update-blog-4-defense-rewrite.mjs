// Restructure "為什麼這是過度防守" section around cost basis.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldBlock = `<h3>為什麼這是「過度防守」</h3>

<p>5/14 那天 88C 確實 ITM、defense 有合理性 — <strong>問題不在「該不該 roll」，而在「strike 拉到哪」</strong>。</p>

<p>要把部位從 ITM 拉回 OTM，最少只需要 strike 過 $89.38。所以：</p>

<ul>
  <li><strong>+2 到 90</strong>：OTM $0.62（剛剛好脫離 ITM，仍貼近 ATM）</li>
  <li><strong>+3 到 91</strong>：OTM $1.62（小幅 buffer）</li>
  <li><strong>+4 到 92</strong>（這筆 trade 的選擇）：OTM $2.62（已經 +2.9% buffer）</li>
</ul>

<p>對一個只剩 5 個 trading days 的短期 sell call 來說，<strong>+2.9% buffer 是過度的</strong>。短天期 option 的時間衰減快、IV 也會自己回落，根本不需要這麼大的 cushion。每多 1 個 strike point，平倉成本 / 新開倉 credit 損失都明顯放大 — 拉到 +4 比拉到 +2 大概多付 50–80% 的成本。</p>

<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>原 88C ITM 只有 $1.38；用 +4 strike 來 fix，明顯防得太多、付得太多。</strong></p>
</div>

<p>事後的 bonus：隔天 5/15 COPX 重挫到 $83.05，<strong>原 88C 自己回到 OTM、會 worthless expire</strong>。但這是後見之明，trade 時不能假設市場會這樣發展。<strong>真正的 critique 是 ex-ante 的:就算需要 defend，+4 也是太多。</strong></p>`;

const newBlock = `<h3>為什麼這是「過度防守」</h3>

<p>這筆 defend 的問題分兩層：<strong>根本不需要 defend</strong>；<strong>就算要 defend，+4 也是太多</strong>。</p>

<p><strong>第一層：根本不需要 defend。</strong>持有 COPX 正股的成本是 <strong>$80.54</strong>。如果 88C 真的被指派（以 $88 賣出 100 股），實現獲利是 ($88 − $80.54) × 100 = <strong>$746</strong>（單股 +9.3%）。對 covered call 策略來說，<strong>被指派從來不是失敗</strong> — 它是策略的 designed outcome 之一。當行權價已經是 acceptable 的賣出價時，假設「必須 defend」本身就錯了，是把好結果當成壞結果處理。況且 COPX 過去 20 天的劇烈 V 型（$76 → $91 → $83）看起來，$89 附近可能就是接近高點的 exit window，不是該死守的位置。</p>

<p><strong>第二層：就算要 defend，+4 也是太多。</strong>從 ITM 拉回 OTM，最少只需要 strike 過 $89.38：</p>

<ul>
  <li><strong>+2 到 90</strong>：OTM $0.62（剛好脫離 ITM）</li>
  <li><strong>+3 到 91</strong>：OTM $1.62（小幅 buffer）</li>
  <li><strong>+4 到 92</strong>（這筆 trade 的選擇）：OTM $2.62（+2.9% buffer）</li>
</ul>

<p>對一個只剩 5 個 trading days 的短期 sell call 來說，<strong>+2.9% buffer 是過度的</strong>。每多 1 個 strike point，付出的成本明顯放大 — 拉到 +4 比拉到 +2 大概多付 50–80%。</p>

<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>持股成本 $80.54，被指派出場就是 +9.3% 獲利。硬要 defend 還拉到 +4，是把好結果當成壞結果在處理，多付 $138.5。</strong></p>
</div>

<p>事後的 bonus：隔天 5/15 COPX 重挫到 $83.05，<strong>原 88C 自己回到 OTM、會 worthless expire</strong>。但這是後見之明，trade 時不能假設市場會這樣發展。<strong>真正的 critique 是 ex-ante：根本不該 defend；就算要 defend，+4 也太多。</strong></p>`;

if (!original.includes(oldBlock)) {
  console.error('ERROR: section block not found.');
  process.exit(1);
}
const updated = original.replace(oldBlock, newBlock);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-defense-rewrite.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
