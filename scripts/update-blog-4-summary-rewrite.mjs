// Rewrite the 總結 callout to base recommendations on
// "正股有收益且被 CALL 走也沒關係" as the default premise.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const oldStr = `<div style="border-left:4px solid #22a37f;background:rgba(34,163,127,0.09);padding:14px 20px 16px;margin:24px 0;border-radius:0 8px 8px 0;">
  <div style="font-size:1rem;font-weight:700;color:#1a7a5a;letter-spacing:1px;margin-bottom:10px;">🎯 總結：sell call 防守 roll-up 該拉多少</div>
  <p style="margin:6px 0 8px;">Sell call 被打到 ITM 時，roll up 是合理的防守 — 但 strike 拉多少要看「剛好脫離 ITM + 一點 buffer」就夠，不是越遠越安全：</p>
  <ul style="margin:6px 0 10px;padding-left:1.4em;">
    <li style="margin:6px 0;"><strong>目標</strong>：把新 strike 拉到剛好 OTM、加上 1–2% 的小 buffer（對短天期 option 已足夠）</li>
    <li style="margin:6px 0;"><strong>不該做</strong>：硬塞 3%+ 的 cushion 換「絕對安心」 — 每多 1 strike 的邊際代價遞增，但邊際保護效用遞減</li>
    <li style="margin:6px 0;"><strong>更該做的</strong>：如果 ITM 深度真的讓你不安，考慮直接平倉認賠 / 不開新部位，而不是一直付錢 defend</li>
  </ul>
  <p style="margin:8px 0 0;">下單前問自己：<strong>「我多付的這 X 元現金，買到的是『實際必要的保護』還是『心理上的安心』？」</strong> 如果是後者 — 通常多拉 2 個 strike 換來的只是錯覺。</p>
</div>`;

const newStr = `<div style="border-left:4px solid #22a37f;background:rgba(34,163,127,0.09);padding:14px 20px 16px;margin:24px 0;border-radius:0 8px 8px 0;">
  <div style="font-size:1rem;font-weight:700;color:#1a7a5a;letter-spacing:1px;margin-bottom:10px;">🎯 總結：先決定要不要被指派，再決定要不要展期</div>
  <p style="margin:6px 0 8px;">前提：<strong>正股已經有未實現獲利，被 call 走只是換現金、不是虧損</strong>。從這個前提出發，sell call 被打到 ITM 時的處理順序應該是：</p>
  <ol style="margin:6px 0 10px;padding-left:1.4em;">
    <li style="margin:6px 0;"><strong>預設做法：讓它被指派</strong>。鎖定正股的獲利 + 已收的 call 權利金，<strong>展期成本為零</strong>。這通常是期望值最高的選擇。</li>
    <li style="margin:6px 0;"><strong>只有「真的還想長期持有正股」時才展期</strong>。目標是把新 strike 拉到<strong>剛好 OTM</strong>（+1~+2%），讓部位脫離 ITM 就好 — 展期是為了保住股票，不是為了賺更多 call 權利金。</li>
    <li style="margin:6px 0;"><strong>絕對不該做</strong>：為了「絕對安心」硬拉 3%+ cushion。這是用真實現金去買心理安慰，每多 1 strike 邊際代價遞增、邊際保護效用遞減。</li>
  </ol>
  <p style="margin:8px 0 0;">下單前先問自己：<strong>「如果被 call 走，我會難過嗎？」</strong> 如果答案是不會 — 那連展期都不需要，直接讓它被指派。如果會 — 展期的目的是「剛好保住股票」，不是「展到絕對 OTM」。多花的每一塊現金，都在侵蝕你正股原本就有的獲利。</p>
</div>`;

if (!original.includes(oldStr)) {
  console.error('ERROR: substring not found.');
  process.exit(1);
}
const updated = original.replace(oldStr, newStr);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-summary-rewrite.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
