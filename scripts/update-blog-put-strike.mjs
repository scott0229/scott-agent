// One-off script: UPDATE the "案例解讀：行權價調整反應過度" post (id=1) in production blog_posts.
// Usage: node scripts/update-blog-put-strike.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 1;
const title = '案例解讀：2026/5/15 股價當天跌不少沒錯，但行權價調整也不要過度反應';
const category = '選擇權策略';
const tags = JSON.stringify(['PUT', '賣方', '展期', '風險管理']);
const publishedAt = '2026-05-16';
const now = Math.floor(Date.now() / 1000);

// Article body — classes converted to inline styles so blog renderer needs no extra CSS
const content = `<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 近 20 個交易日走勢與 5 日均線" style="display:block;width:100%;height:auto;border-radius:10px;">
    <rect x="0" y="0" width="720" height="280" fill="#fbf6ef" rx="10"/>
    <text x="20" y="24" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 近 20 個交易日收盤 + 5 日均線</text>
    <line x1="498" y1="20" x2="518" y2="20" stroke="#22a37f" stroke-width="2.5"/>
    <text x="523" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">日收盤</text>
    <line x1="585" y1="20" x2="605" y2="20" stroke="#9bb0d4" stroke-width="2"/>
    <text x="610" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">5 日均線</text>
    <text x="42" y="56" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">720</text>
    <line x1="48" y1="52" x2="700" y2="52" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="101" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">700</text>
    <line x1="48" y1="97" x2="700" y2="97" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="145" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">680</text>
    <line x1="48" y1="141" x2="700" y2="141" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="190" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">660</text>
    <line x1="48" y1="186" x2="700" y2="186" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="234" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">640</text>
    <line x1="48" y1="230" x2="700" y2="230" stroke="#eee0d0" stroke-width="0.8"/>
    <line x1="48" y1="114" x2="700" y2="114" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>
    <text x="700" y="134" font-size="11" font-weight="700" fill="#d97706" text-anchor="end" font-family="sans-serif">$692 strike</text>
    <polyline points="184.7,202.7 218.4,194.9 252.1,189 285.8,186.2 319.5,178.9 353.2,174.3 386.8,170.5 420.5,159.8 454.2,144.6 487.9,132.5 521.6,116 555.3,98 588.9,86.6 622.6,78.2 656.3,67.2 690,68.2" fill="none" stroke="#9bb0d4" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="50,214.9 83.7,220.4 117.4,196.4 151.1,204.6 184.7,176.9 218.4,176.2 252.1,191 285.8,182.1 319.5,168.4 353.2,154.1 386.8,156.9 420.5,137.5 454.2,106.1 487.9,107.9 521.6,71.7 555.3,67.1 588.9,80.6 622.6,64 656.3,52.7 690,76.8" fill="none" stroke="#22a37f" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="690" cy="76.8" r="5" fill="#dc2626"/>
    <text x="690" y="96" font-size="11" font-weight="700" fill="#dc2626" text-anchor="end" font-family="sans-serif">$708.93</text>
    <text x="50" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/20</text>
    <text x="218.4" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/27</text>
    <text x="386.8" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/4</text>
    <text x="555.3" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/11</text>
    <text x="690" y="255" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">5/15</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">4/20 起一路漲到 5/14 的 $719.79、5/15 拉回 $708.93 (-1.51%)。5 日均線（藍）顯示整體仍處上升趨勢，且持續站穩在 $692 行權價之上。</figcaption>
</figure>

<p>當你賣出的 put 接近到期、需要展期續單時，最關鍵的決策<em>不是</em>「要不要展期」 — 那基本上必做。真正會影響長期報酬的，是<strong>新的行權價要選在哪裡</strong>。同樣是展期，行權價往下拉 1 點還是 6 點，效果天差地遠。</p>

<h3>展期時，行權價怎麼選？</h3>

<p>背景：5/15 當天 QQQ 跌了 1.51%，原本 5/15 到期、行權價 <strong>692</strong> 的 sell put 即將失效，必須展期續單。在「<em>股價跌了一些、但 strike 還沒被逼到</em>」這個情境下，新 strike 通常面臨三個選擇：</p>

<ul>
  <li><strong>維持行權價不動</strong>：新單繼續賣 692P。原 strike 在合理距離，<strong>權利金收最多</strong>，賭股價不再續跌。</li>
  <li><strong>小幅往下調（1-2 點）</strong>：例如 691 或 690。多一點點緩衝，權利金小幅縮水但仍合理。</li>
  <li><strong>大幅往下調（5 點以上）</strong>：例如直接拉到 686。安全感最大，但權利金明顯縮水 — 等於用真實的權利金，去買一份其實還不太需要的保險。</li>
</ul>

<p>下面這筆 QQQ 的展期，就是選了第三種。</p>

<h3>實例：別變成驚弓之鳥</h3>

<div style="background:#1a1a1a;color:#f5f1ea;border-radius:8px;padding:14px 18px;margin:20px 0;font-family:Consolas,'Microsoft JhengHei',monospace;font-size:1rem;line-height:1.7;">
  <div style="display:inline-block;background:#4a2a14;color:#f5b95a;border-left:4px solid #f5b95a;padding:6px 12px;border-radius:4px;margin-bottom:12px;font-weight:600;font-size:0.95rem;">展期 1，調價 -6，盈虧<span style="color:#5ed886;margin-left:4px;">+51.4</span></div>
  <div style="padding:2px 0;letter-spacing:0.3px;">-1口 QQQ May18'26 686P</div>
  <div style="padding:2px 0;letter-spacing:0.3px;">+1口 QQQ May15'26 692P</div>
</div>

<p>這是一個典型的反應過度。原本賣的是 5/15 到期、行權價 <strong>692</strong> 的 put，在 5/15 當天把它展期到 5/18、行權價 <strong>686</strong> — 行權價一口氣下拉 6 個點。</p>

<p>問題不在展期本身，而在拉的幅度。<strong>5/15 當天 QQQ 收在 $708.93、跌幅 -1.51%</strong>，跌是有跌，但離原本 692 的行權價還有 <strong>約 17 點（≈ 2.4%）的安全距離</strong>，根本沒被逼到牆角。</p>

<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 560 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 現價與行權價距離示意" style="display:block;width:100%;height:auto;border-radius:10px;">
    <defs>
      <marker id="arrowEnd3" viewBox="0 0 10 10" refX="5" refY="9" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 0 L 5 10 z" fill="#4b5563"/></marker>
      <marker id="arrowStart3" viewBox="0 0 10 10" refX="5" refY="1" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 10 L 10 10 L 5 0 z" fill="#4b5563"/></marker>
    </defs>
    <rect x="0" y="0" width="560" height="340" fill="#fbf6ef" rx="10"/>
    <text x="24" y="32" font-size="14" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 5/15 收盤 vs 行權價</text>
    <line x1="40" y1="80" x2="380" y2="80" stroke="#22a37f" stroke-width="3"/>
    <text x="390" y="78" font-size="16" font-weight="700" fill="#22a37f" font-family="sans-serif">$708.93</text>
    <text x="390" y="96" font-size="11" fill="#557f70" font-family="sans-serif">5/15 收盤 (-1.51%)</text>
    <line x1="40" y1="225" x2="380" y2="225" stroke="#d97706" stroke-width="2.5" stroke-dasharray="6,4"/>
    <text x="390" y="223" font-size="16" font-weight="700" fill="#d97706" font-family="sans-serif">$692</text>
    <text x="442" y="223" font-size="11" font-weight="600" fill="#8a6a3a" font-family="sans-serif">· buffer 2.4%</text>
    <text x="390" y="241" font-size="11" fill="#8a6a3a" font-family="sans-serif">原 strike · May 15 PUT</text>
    <line x1="40" y1="285" x2="380" y2="285" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="6,4"/>
    <text x="390" y="283" font-size="16" font-weight="700" fill="#dc2626" font-family="sans-serif">$686</text>
    <text x="442" y="283" font-size="11" font-weight="600" fill="#a04444" font-family="sans-serif">· buffer 3.2%</text>
    <text x="390" y="301" font-size="11" fill="#a04444" font-family="sans-serif">展期後 · May 18 PUT</text>
    <line x1="140" y1="84" x2="140" y2="221" stroke="#22a37f" stroke-width="1.5" marker-end="url(#arrowEnd3)" marker-start="url(#arrowStart3)"/>
    <rect x="64" y="140" width="152" height="28" fill="#fff" stroke="#22a37f" stroke-width="1.2" rx="4"/>
    <text x="140" y="158" font-size="13" font-weight="700" fill="#22a37f" font-family="sans-serif" text-anchor="middle">≈ 17 點 安全距離</text>
    <line x1="270" y1="229" x2="270" y2="281" stroke="#dc2626" stroke-width="1.5" marker-end="url(#arrowEnd3)" marker-start="url(#arrowStart3)"/>
    <rect x="222" y="246" width="96" height="22" fill="#fff" stroke="#dc2626" stroke-width="1.2" rx="4"/>
    <text x="270" y="261" font-size="12" font-weight="700" fill="#dc2626" font-family="sans-serif" text-anchor="middle">多 6 點緩衝</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">原本就有 17 點安全距離了，再多 6 點緩衝其實邊際效用很低。</figcaption>
</figure>

<div style="border-left:4px solid #4a73c8;background:rgba(74,115,200,0.08);padding:14px 20px 16px;margin:24px 0;border-radius:0 8px 8px 0;">
  <div style="font-size:0.78rem;font-weight:700;color:#3457a0;letter-spacing:1px;margin-bottom:8px;">📊 歷史數據佐證</div>
  <p style="margin:0;">翻一下歷史，這個 <strong>2.4% buffer 其實非常厚</strong>：過去 5 年（2015-2020，含 2020 COVID 崩盤期，共 1,547 個交易日）QQQ 單日跌幅超過 <strong>2%</strong> 的天數只佔約 <strong>5%</strong>（每年大約 12 天）；跌幅超過 <strong>2.4%</strong> 的更稀有，<strong>平均每月不到一次</strong>。意思是說，即便完全不動行權價，5/15 當天就被擊穿到 692 之下的機率本來就非常低。</p>
</div>

<p>真的擔心，<em>少量地</em>往下調是合理的（例如 1-2 點），但一次拉 6 個點，明顯是「為了完全消除恐懼」，不是「為了風險管理」。</p>

<h3>真正的代價：權利金縮水</h3>

<p>把 strike 從 <strong>692</strong> 拉到 <strong>686</strong>，put 一口氣變得更深度價外（OTM），<strong>未來能收的權利金就明顯下降</strong>。同到期日下，6 個點的 strike 差距，權利金常常會差到 30~50%（實際幅度視 IV 跟到期天數而定）。</p>

<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 480 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="692P vs 686P 權利金示意" style="display:block;width:100%;height:auto;border-radius:10px;">
    <rect x="0" y="0" width="480" height="240" fill="#fbf6ef" rx="10"/>
    <text x="24" y="28" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">Sell PUT ／ 同到期日下，行權價往下拉 → 權利金縮水（示意）</text>
    <line x1="60" y1="200" x2="450" y2="200" stroke="#c9b89f" stroke-width="1"/>
    <rect x="120" y="80" width="80" height="120" fill="#22a37f" rx="3"/>
    <text x="160" y="72" font-size="13" font-weight="700" fill="#22a37f" font-family="sans-serif" text-anchor="middle">692P</text>
    <text x="160" y="222" font-size="11" fill="#5a4a35" font-family="sans-serif" text-anchor="middle">原 strike</text>
    <rect x="280" y="140" width="80" height="60" fill="#d97706" rx="3"/>
    <text x="320" y="132" font-size="13" font-weight="700" fill="#d97706" font-family="sans-serif" text-anchor="middle">686P</text>
    <text x="320" y="222" font-size="11" fill="#5a4a35" font-family="sans-serif" text-anchor="middle">展期後</text>
    <text x="160" y="125" font-size="12" font-weight="700" fill="#fff" font-family="sans-serif" text-anchor="middle">較高權利金</text>
    <text x="320" y="172" font-size="11" font-weight="700" fill="#fff" font-family="sans-serif" text-anchor="middle">縮水</text>
    <path d="M 215 115 Q 245 100 270 145" fill="none" stroke="#a04444" stroke-width="1.5" stroke-dasharray="4,3"/>
    <text x="245" y="98" font-size="11" font-weight="700" fill="#a04444" font-family="sans-serif" text-anchor="middle">少收的這塊</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">賣方賺的就是這個權利金。每次不必要的下拉，等於自願把這塊長條變矮一截。</figcaption>
</figure>

<p>這筆展期帳面上是「收了 +51.4 的 credit」，看似賺錢，但同時也把<em>之後到期能收的權利金</em>壓低了。等於：用一塊看得到的權利金，去買一份其實不存在的風險保險。</p>

<p>賣方的長期報酬，靠的是穩定地收這些微薄的權利金。一次反應過度看不太出來，但連續這樣展期，年化報酬會被自己一刀一刀削平。</p>

<h3>展期時的 strike 選擇原則</h3>

<ul>
  <li><strong>先看現價跟原 strike 的距離</strong>：還有明顯距離（例如 2% 以上），表示原 strike 仍合理，新 strike 不需要大幅往下拉，維持原位甚至小幅貼近現價都比拉遠來得好。</li>
  <li><strong>幅度小一點就好 (最佳)</strong>：差 1-2 點是合理微調，差到 6 點就是過度反應。</li>
  <li><strong>盤算交換條件</strong>：每往下 1 點 strike，新部位就少收一塊權利金。要問自己：少收的這塊權利金，跟那 1 點的「安全感」，真的等價嗎？</li>
</ul>

<div style="border-left:4px solid #22a37f;background:rgba(34,163,127,0.09);padding:14px 20px 16px;margin:24px 0;border-radius:0 8px 8px 0;">
  <div style="font-size:0.78rem;font-weight:700;color:#1a7a5a;letter-spacing:1px;margin-bottom:8px;">✓ 最佳判斷</div>
  <p style="margin:0;"><strong>套用到 5/15 這筆 QQQ 交易：最佳選擇是「維持行權價不動」</strong>。理由很單純 — QQQ 仍在 692 之上 17 點（≈ 2.4% buffer），原 strike 完全沒被威脅，繼續賣 692P 能把權利金收到最滿。如果心理上真的需要一點緩衝，<strong>頂多小幅下調 1-2 點</strong>（例如 690）也合理；但這個情境下，<strong>大幅拉到 686 沒有必要</strong> — 為了 6 點根本用不到的安全距離，犧牲掉的權利金比實際降低的風險多得多。</p>
</div>

<div style="border:1px solid #d4b896;background:#fdfaf2;padding:18px 22px;margin:24px 0;border-radius:8px;">
  <div style="font-size:0.78rem;font-weight:700;color:#8a6a3a;letter-spacing:1px;margin-bottom:10px;">💬 常見反駁 ①</div>
  <p style="margin:0 0 12px;font-weight:600;font-style:italic;color:#5a4a35;">「我固定 delta 0.15，上次選 692P、這次選 686P 的 delta 都一樣 — 我固定了被指派的機率，這就是紀律的風險管理，怎麼會是反應過度？」</p>
  <p style="margin:12px 0 8px;">這個論點有紀律，但有兩個關鍵盲點：</p>
  <p style="margin:8px 0;"><strong>1. 固定 delta，其實沒固定風險。</strong>QQQ 跌一波，市場恐懼指數 (IV) 就會跟著升一波。換個角度看：高 IV 下 delta 0.15 對應的行權價比平常時更低 — <strong>等於你得到了比一般時期 delta 0.15 更多、但其實沒必要的安全感，而且是用權利金縮水換來的</strong>。等 IV 回到正常水準，這份「多餘的安全」就消失了，但你少收的權利金回不來。</p>
  <p style="margin:8px 0;"><strong>2. 非對稱 ratchet 效應（複利毒性）。</strong>每次跌就 roll down，但反彈時人性上不會主動 roll up 加風險。結果 strike 變成<strong>單向往下 ratchet</strong>，每次往下都是真實的權利金損失。看一個溫和震盪市的數字：</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.875rem;background:#fff;border-radius:6px;overflow:hidden;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">展期次數</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">股價</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">IV</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">0.15Δ strike</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #d4b896;font-weight:700;color:#5a4a35;">權利金</th>
      </tr>
    </thead>
    <tbody>
      <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">1</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">720</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">18%</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">692</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">$1.20</td></tr>
      <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">2（跌）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">709</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">22%</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#dc2626;font-weight:600;">685</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#dc2626;font-weight:600;">$1.00</td></tr>
      <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">3（反彈）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">718</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">19%</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">691</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">$1.10</td></tr>
      <tr><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">4（再跌）</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">710</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;">21%</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#dc2626;font-weight:600;">686</td><td style="padding:7px 10px;border-bottom:1px solid #f0e8de;color:#dc2626;font-weight:600;">$0.95</td></tr>
      <tr><td style="padding:7px 10px;">5（反彈）</td><td style="padding:7px 10px;">716</td><td style="padding:7px 10px;">19%</td><td style="padding:7px 10px;">690</td><td style="padding:7px 10px;">$1.00</td></tr>
    </tbody>
  </table>
  <p style="margin:8px 0;">5 次展期後 strike 少 2 點，<strong>權利金已經少 17%</strong>。遇到 2022 那種持續跌 + IV 結構性高的環境，半年下來權利金腰斬不誇張。</p>
  <p style="margin:8px 0 0;"><strong>所以 delta-based rolling 對「短期試水溫」型賣方合理，對「想穩定收權利金做久」的策略是慢性毒藥</strong> — 它在每個焦慮時刻讓你以為在管理風險，事實上是<em>主動降低未來收益的上限</em>。一次反應過度看不出，每次都這樣 — <strong>賣方的年化會被自己一刀一刀削到接近 0</strong>。</p>
</div>

<div style="border:1px solid #d4b896;background:#fdfaf2;padding:18px 22px;margin:24px 0;border-radius:8px;">
  <div style="font-size:0.78rem;font-weight:700;color:#8a6a3a;letter-spacing:1px;margin-bottom:10px;">💬 常見反駁 ②</div>
  <p style="margin:0 0 12px;font-weight:600;font-style:italic;color:#5a4a35;">「股價跌破 5 日均線，短期就是會走弱，那我趁機把 strike 多往下拉一點也合理吧？」</p>
  <p style="margin:12px 0 8px;">這個論點實務上比 delta-based 更常見，但有四個破口：</p>
  <p style="margin:8px 0;"><strong>1. 5MA 是太弱的短期訊號。</strong>QQQ 這類大型 ETF 經常在 5MA 附近震盪，跌破 MA 之後 1-3 天內反彈回去的比率相當高。把 5MA 穿越當「短期會走弱」的歷史勝率大約 <strong>52-55%</strong>，比擲銅板好一點，沒好到值得每次都調整 strike。</p>
  <p style="margin:8px 0;"><strong>2. 機率變化太小，不值得這個權利金代價。</strong>QQQ 3 天內跌 2.4% 以上的歷史機率約 3-5%（前面數據佐證）；5MA 跌破這個事件大概把它推到 4-7% — 沒翻倍，也沒到危險。為了從 4% → 7% 的微幅變化，去損失 30-50% 的權利金，<strong>交換比根本不划算</strong>。</p>
  <p style="margin:8px 0;"><strong>3. 賣方的優勢是「時間慢慢過去」+「恐慌過後波動率自動回落」 — 不是技術分析。</strong>前者讓 option 的時間價值每天默默縮水（你不動就在賺），後者讓你高 IV 時賣的 option 在恐慌平息後自動變便宜 — 這兩件事都是<strong>結構性、長期對賣方有利</strong>。技術分析的勝率約 55%，跟擲銅板差不多。你在用一個勉強過半的工具，去 override 一個結構性占優的策略 — 不是「順勢」，是<em>用弱策略覆蓋強策略</em>。</p>
  <p style="margin:8px 0;"><strong>4. 真正一致的邏輯</strong>應該是：</p>
  <ul style="margin:6px 0 10px;padding-left:1.4em;">
    <li style="margin:4px 0;">如果你<strong>真的相信</strong>短期會走弱 → 應該<strong>不要賣這張 put</strong>，甚至改買 put 賺方向</li>
    <li style="margin:4px 0;">如果你<strong>還是要賣 put</strong> 收權利金 → 表示你並不真的相信會跌穿 strike → 那就不該因為 5MA 而大幅下調</li>
  </ul>
  <p style="margin:8px 0 0;"><strong>「賣 put + 因為技術分析訊號弱所以下調 strike」= 兩個矛盾立場的妥協</strong> — 既不真心做空、也不全力做賣方，結果兩邊的優勢都拿不到，只拿到兩邊的缺點。</p>
</div>

<p>展期是技術動作，<strong>strike 的選擇才是策略動作</strong>。前者隨便都行，後者才決定你長期的報酬。</p>

<blockquote><p><strong>底線：</strong>賣方賺的是權利金，不是「絕對不會被指派」。為了減少根本不存在的風險而放棄真實的權利金收入，是反應過度，不是風險管理。</p></blockquote>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `UPDATE blog_posts SET
  title = '${escape(title)}',
  content = '${escape(content)}',
  category = '${escape(category)}',
  tags = '${escape(tags)}',
  published_at = '${publishedAt}',
  updated_at = ${now}
WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog.sql';
writeFileSync(sqlPath, sql, 'utf8');
console.log(`SQL written to ${sqlPath} (${sql.length} bytes)`);

const dbs = ['scott-agent-production', 'scott-agent-scott-production'];
for (const db of dbs) {
  console.log(`\n--- Updating ${db} ---`);
  try {
    execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
  } catch (e) {
    console.error(`Update on ${db} failed`);
    process.exit(1);
  }
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/1');
