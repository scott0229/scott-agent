// One-off script: INSERT blog/5 "2026/5/20 同日兩次方向相反的 roll" into production blog_posts.
// Usage: node scripts/insert-blog-5-same-day-double-roll.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const title = '案例解讀：2026/5/20 同日兩次方向相反的 roll — 不是運氣不好，是 strike 太緊';
const category = '選擇權策略';
const tags = JSON.stringify(['CALL', '賣方', '展期', '風險管理']);
const publishedAt = '2026-05-21';
const now = Math.floor(Date.now() / 1000);

const content = `<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 近 20 個交易日走勢與 5 日均線" style="display:block;width:100%;height:auto;border-radius:10px;">
    <rect x="0" y="0" width="720" height="280" fill="#fbf6ef" rx="10"/>
    <text x="20" y="24" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 近 20 個交易日收盤 + 5 日均線</text>
    <line x1="498" y1="20" x2="518" y2="20" stroke="#22a37f" stroke-width="2.5"/>
    <text x="523" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">日收盤</text>
    <line x1="585" y1="20" x2="605" y2="20" stroke="#9bb0d4" stroke-width="2"/>
    <text x="610" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">5 日均線</text>
    <text x="42" y="56" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">730</text>
    <line x1="48" y1="52" x2="700" y2="52" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="101" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">710</text>
    <line x1="48" y1="97.5" x2="700" y2="97.5" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="147" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">690</text>
    <line x1="48" y1="143" x2="700" y2="143" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="192" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">670</text>
    <line x1="48" y1="188.5" x2="700" y2="188.5" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="238" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">650</text>
    <line x1="48" y1="234" x2="700" y2="234" stroke="#eee0d0" stroke-width="0.8"/>
    <line x1="48" y1="88.4" x2="700" y2="88.4" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="3,3"/>
    <text x="700" y="84" font-size="10" font-weight="600" fill="#dc2626" text-anchor="end" font-family="sans-serif">714 strike (盤中被穿)</text>
    <line x1="48" y1="81.6" x2="700" y2="81.6" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>
    <text x="700" y="74" font-size="11" font-weight="700" fill="#d97706" text-anchor="end" font-family="sans-serif">717 strike (新)</text>
    <polyline points="184.7,211.9 218.4,204.5 252.1,199.8 285.8,195.8 319.5,184.9 353.2,169.3 386.8,156.9 420.5,140.1 454.2,121.7 487.9,110.0 521.6,101.4 555.3,90.1 588.9,91.1 622.6,94.5 656.3,97.1 690,97.8" fill="none" stroke="#9bb0d4" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="50,230.8 83.7,202.4 117.4,201.6 151.1,216.8 184.7,207.7 218.4,193.6 252.1,179.1 285.8,182.0 319.5,162.1 353.2,129.9 386.8,131.8 420.5,94.7 454.2,90.0 487.9,103.8 521.6,86.8 555.3,75.2 588.9,99.9 622.6,106.9 656.3,116.8 690,90.3" fill="none" stroke="#22a37f" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="690" cy="90.3" r="5" fill="#dc2626"/>
    <text x="690" y="116" font-size="11" font-weight="700" fill="#dc2626" text-anchor="end" font-family="sans-serif">$713.15</text>
    <text x="50" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/23</text>
    <text x="218.4" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/30</text>
    <text x="386.8" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/7</text>
    <text x="555.3" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/14</text>
    <text x="690" y="255" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">5/20</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">5/20 QQQ 開盤 $705.29、盤中觸及 $713.15（同時也是收盤價） — 單日 +1.1% 的劇烈漲幅，剛好把開盤選的 714C 的 buffer 從 10 點吃到 1 點以內。</figcaption>
</figure>

<p>這個系列前 4 篇都是「單一 trade 的決策對不對」。這次看一個不同類型的問題：<strong>每個 roll 個別看都合理，但「兩個 roll 加起來」就出了問題</strong>。某交易者在 2026/5/20 一天內做了兩次 roll、方向相反，淨吃掉 $933 的 churn cost。</p>

<p>看 5/19–5/20 連續三筆 trade：</p>

<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.9rem;background:#fff;color:#3a3025;border-radius:6px;overflow:hidden;">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">日期</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">動作</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">標的</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">權利金 / 損益</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/19</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">STO（開）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May20 <strong>715C</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">收 $701.3</td></tr>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/20</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">BTC（平）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May20 715C</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#16a34a;font-weight:600;">損益 +$227</td></tr>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/20</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">STO（roll #1）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May21 <strong>714C</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">收 $955.7</td></tr>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">5/20 <strong>同日</strong></td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">BTC（roll #2）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">QQQ May21 714C</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#dc2626;font-weight:600;">損益 -$933</td></tr>
    <tr><td style="padding:7px 10px;">5/20</td><td style="padding:7px 10px;">STO（roll #2 新部位）</td><td style="padding:7px 10px;">QQQ May21 <strong>717C</strong></td><td style="padding:7px 10px;">收 $1,266.8（持有中）</td></tr>
  </tbody>
</table>

<h3>解讀這串 trade</h3>

<p>5/20 那天三步動作：</p>

<ol>
  <li><strong>早盤平 715C</strong>：開盤 QQQ $705.29，原 715C 已遠在 OTM、要當天到期，輕鬆收 +$227 平倉。沒問題。</li>
  <li><strong>新開 714C May21（roll #1）</strong>：同時間繼續 cashflow，選了 strike <strong>714</strong>（比剛平的 715 低 1 點），收 $955.7。<strong>開盤時 QQQ $705，714 buffer 約 10 點（1.4%） — 看起來合理。</strong></li>
  <li><strong>同日下午平 714C + 開 717C（roll #2）</strong>：盤中 QQQ 一路漲到 $713，714C 從 10 點 buffer 縮到 1 點以內，trader 慌了：付 $933 平 714C，再開 717C 收 $1,266.8。</li>
</ol>

<p>結果：May21 的部位走了 714 → 717 一共 +3 點 strike，但中間付了 <strong>$933 純 churn cost</strong>。</p>

<h3>每個 roll 個別看都合理</h3>

<p>這是這個案例最有意思的地方：</p>

<ul>
  <li><strong>Roll #1（早盤）</strong>：QQQ $705，714C buffer 10 點 — 對 1DTE 是合理的 OTM call。雖然 strike 比剛平的 715 低 1 點（略微積極），但「在原 strike 附近 ±1」是很常見的 strike 選擇。</li>
  <li><strong>Roll #2（盤中）</strong>：QQQ $713，714C buffer 縮到 1 點，明天到期 — 不 roll 等於賭隔天會跌回來，risk/reward 比不利。Roll 到 717 是合理的防守。</li>
</ul>

<p>所以「<strong>該不該做這兩次 roll</strong>」這個問題的答案，個別看都是「該」。問題在更上層：<strong>為什麼會走到要做第二次 roll 的位置？</strong></p>

<h3>真正的問題：strike 選擇沒留給市場「正常波動」的空間</h3>

<p>QQQ 1DTE call 的策略要考慮日波動性：</p>

<ul>
  <li>QQQ 平均日波動 ~0.8–1.2%（6–8 點）</li>
  <li>大波動日（FOMC、CPI、財報）容易 1.5–2%（10–15 點）</li>
  <li>過去 5 年 QQQ 單日漲幅 ≥ 1.4% 的天數約佔 <strong>22%</strong>（每年約 55 天）</li>
</ul>

<p>開盤選 714（buffer 10 點 / 1.4%）= <strong>把策略命運交給「今天 QQQ 漲幅 &lt; 1.4%」這個賭注</strong>。5 個交易日就有 1 天會打穿這個 buffer。5/20 剛好就是被打穿的那天。</p>

<p>換算 risk/reward：</p>

<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.9rem;background:#fff;color:#3a3025;border-radius:6px;overflow:hidden;">
  <thead>
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">策略</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">多收的 premium</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">第二次 roll 風險</th>
      <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">淨結果</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">開盤直接選 717</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">基準</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">幾乎免疫於 1.4% 漲幅</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#16a34a;font-weight:600;">乾淨</td></tr>
    <tr><td style="padding:7px 10px;">開盤選 714（實際）</td><td style="padding:7px 10px;">多收 ~$200</td><td style="padding:7px 10px;">QQQ 漲 &gt; 1.4% 就被迫 roll，付 $933</td><td style="padding:7px 10px;color:#dc2626;font-weight:600;">淨虧 ~$700</td></tr>
  </tbody>
</table>

<p>trader 為了多收 ~$200 premium，承擔了「賭錯就 -$933」的風險。期望值看起來不划算 — 除非 trader 認為自己對短期方向的預測準確度足以彌補。</p>

<div style="border-left:4px solid #dc2626;background:rgba(220,38,38,0.06);padding:14px 20px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0;font-size:1.05rem;color:#7a1f1f;"><strong>同日兩次方向相反的 roll，通常代表「開盤時對 strike 的選擇基於對短期方向的判斷」 — 而判斷錯了，就要當天用真實現金 fix。</strong></p>
</div>

<div style="border:1px solid #d4b896;background:#fdfaf2;color:#3a3025;padding:18px 22px;margin:24px 0;border-radius:8px;">
  <div style="font-size:1rem;font-weight:700;color:#8a6a3a;letter-spacing:1px;margin-bottom:10px;">💬 常見反駁</div>
  <p style="margin:0 0 12px;font-weight:600;font-style:italic;color:#5a4a35;">「但 QQQ 漲那麼多誰能預料？這是壞運氣，不是 strike 太緊。」</p>
  <p style="margin:8px 0;">這個論點本身就是問題的根源。賣方 risk management 的核心不是「<strong>預測市場</strong>」，而是「<strong>選一個 buffer 大到就算市場不利也還在 manageable 區間的 strike</strong>」。</p>
  <p style="margin:8px 0 0;">1DTE call 選 1.4% buffer = 把整體策略的存活率交給「今天波動是否高於 1.4%」。而這個機率不是低的（過去 5 年 22%）。<strong>當「策略容易被市場正常波動擊潰」時，那不是運氣問題，是設計問題。</strong></p>
</div>

<div style="border-left:4px solid #22a37f;background:rgba(34,163,127,0.09);padding:14px 20px 16px;margin:24px 0;border-radius:0 8px 8px 0;">
  <div style="font-size:1rem;font-weight:700;color:#1a7a5a;letter-spacing:1px;margin-bottom:10px;">🎯 總結：1DTE / 短天期 sell call 的紀律</div>
  <ul style="margin:6px 0 10px;padding-left:1.4em;">
    <li style="margin:6px 0;"><strong>buffer 至少 2%+</strong>：不要為了多收 $0.5/股的 premium 把 strike 拉到 1% 以內。QQQ 過去 5 年單日漲 ≥ 2% 的天數只佔 ~5%，buffer 2% 就把策略命運從「22% 機率被打穿」拉到「5%」。</li>
    <li style="margin:6px 0;"><strong>設「不再 roll」threshold</strong>：同一天市場已往不利方向動 1%+ 時，直接平倉認賠、不開新部位往往比 roll 第二次便宜。每次盤中 roll 都是在「最貴的時刻」付錢（IV 飆 + option 都更貴）。</li>
    <li style="margin:6px 0;"><strong>觀察自己的模式</strong>：如果「常常一天 roll 兩次」是常態，那是 strike 選擇系統性太緊。要調整的是 baseline strike 距離，不是調整單次 roll。</li>
  </ul>
  <p style="margin:8px 0 0;">下單前問自己：<strong>「這個 strike，如果今天 QQQ 漲 1.5%，我還 OK 嗎？」</strong> 答 No → 把 strike 拉遠一點。</p>
</div>

<blockquote><p><strong>底線：</strong>賣方賺的是「small wins 累積」；同日 churn loss $933 等於大概 5–10 次正常 roll 的累積收益。<strong>一次 churn 就抹掉好幾天的辛苦 — 而 churn 的根源不是運氣不好，是 strike 選擇沒留足夠 buffer 給市場正常的隨機波動。</strong></p></blockquote>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `INSERT INTO blog_posts (title, content, category, tags, published_at, author_id, created_at, updated_at)
VALUES ('${escape(title)}', '${escape(content)}', '${escape(category)}', '${escape(tags)}', '${publishedAt}', NULL, ${now}, ${now});`;

const sqlPath = 'scripts/.tmp-insert-blog.sql';
writeFileSync(sqlPath, sql, 'utf8');
console.log(`SQL written to ${sqlPath} (${sql.length} bytes)`);

const dbs = ['scott-agent-production', 'scott-agent-scott-production'];
for (const db of dbs) {
  console.log(`\n--- Inserting into ${db} ---`);
  try {
    execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`Insert into ${db} failed`);
    process.exit(1);
  }
}

console.log('\n✅ Done. Visit https://scott-agent.com/blog');
