// One-off script: inserts the "PUT 行權價該怎麼調整" article into production blog_posts.
// Usage: node scripts/insert-blog-put-strike.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const title = '標的股價下跌，PUT 行權價該怎麼調整？';
const category = '選擇權策略';
const tags = JSON.stringify(['PUT', '賣方', 'Roll', '風險管理']);
const publishedAt = '2026-05-16';
const now = Math.floor(Date.now() / 1000);

// Article body with inline styles (class → style, so blog renderer doesn't need extra CSS)
const content = `<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 560 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 近 6 個交易日走勢" style="display:block;width:100%;height:auto;border-radius:10px;">
    <rect x="0" y="0" width="560" height="220" fill="#fbf6ef" rx="10"/>
    <text x="24" y="26" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 近 6 個交易日收盤</text>
    <text x="42" y="60" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">720</text>
    <line x1="48" y1="56" x2="540" y2="56" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="93" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">710</text>
    <line x1="48" y1="89" x2="540" y2="89" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="125" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">700</text>
    <line x1="48" y1="121" x2="540" y2="121" stroke="#eee0d0" stroke-width="0.8"/>
    <line x1="48" y1="147" x2="540" y2="147" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>
    <text x="544" y="151" font-size="11" font-weight="700" fill="#d97706" font-family="sans-serif">$692 strike</text>
    <polyline points="80,85 164,78 248,98 332,73 416,57 500,92" fill="none" stroke="#22a37f" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="80" cy="85" r="3" fill="#22a37f"/>
    <circle cx="164" cy="78" r="3" fill="#22a37f"/>
    <circle cx="248" cy="98" r="3" fill="#22a37f"/>
    <circle cx="332" cy="73" r="3" fill="#22a37f"/>
    <circle cx="416" cy="57" r="3" fill="#22a37f"/>
    <circle cx="500" cy="92" r="5" fill="#dc2626"/>
    <text x="500" y="78" font-size="11" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">$708.93</text>
    <text x="500" y="113" font-size="10" font-weight="600" fill="#dc2626" text-anchor="middle" font-family="sans-serif">-1.51%</text>
    <text x="80" y="195" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/8</text>
    <text x="164" y="195" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/11</text>
    <text x="248" y="195" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/12</text>
    <text x="332" y="195" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/13</text>
    <text x="416" y="195" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/14</text>
    <text x="500" y="195" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">5/15</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">5/14 衝到 $719.79、5/15 拉回 $708.93 (-1.51%) — 即便如此，仍在 $692 行權價之上約 17 點。</figcaption>
</figure>

<p>當你賣出一張 cash-secured put 之後，股價跌破或逼近行權價，這是賣方最常見的壓力情境。先別急著加倉攤平，先冷靜判斷三件事。</p>

<h3>三個選擇</h3>

<ol>
  <li><strong>讓它被指派（接股）</strong>：如果你當初就是「願意以這個價位持有這檔股票」才賣 put，那麼只要基本面沒變、行權價依然是你願意承接的價位，最理性的做法就是接下來。賣 put 的本質就是「給自己付錢買進場機會」。</li>
  <li><strong>Roll Down + Out</strong>：把現有的 put 平倉、同時在<em>較低行權價</em>與<em>較晚到期日</em>賣一張新的 put。注意兩件事：必須能收到 <strong>net credit</strong>（淨權利金），且新的行權價要落在你還能接受的位置。如果為了避免帳面虧損而 roll 到一個你並不想接股的價位，那只是把問題往後推，不是解決。</li>
  <li><strong>直接平倉認賠</strong>：當基本面實質惡化、原本的論點不成立時，最該做的反而是停損出場，把資金留給下一個機會。Put 的時間價值會在深度 ITM 之後快速衰減，越接近到期越難 roll。</li>
</ol>

<h3>實例：別變成驚弓之鳥</h3>

<div style="background:#1a1a1a;color:#f5f1ea;border-radius:8px;padding:14px 18px;margin:20px 0;font-family:Consolas,'Microsoft JhengHei',monospace;font-size:1rem;line-height:1.7;">
  <div style="display:inline-block;background:#4a2a14;color:#f5b95a;border-left:4px solid #f5b95a;padding:6px 12px;border-radius:4px;margin-bottom:12px;font-weight:600;font-size:0.95rem;">展期 1，調價 -6，盈虧<span style="color:#5ed886;margin-left:4px;">+51.4</span></div>
  <div style="padding:2px 0;letter-spacing:0.3px;">-1口 QQQ May18'26 686P</div>
  <div style="padding:2px 0;letter-spacing:0.3px;">+1口 QQQ May15'26 692P</div>
</div>

<p>這是一個典型的反應過度。原本賣的是 5/15 到期、行權價 <strong>692</strong> 的 put，在 5/15 當天把它 roll 到 5/18、行權價 <strong>686</strong> — 行權價一口氣下拉 6 個點。</p>

<p>問題不在 roll 本身，而在拉的幅度。<strong>5/15 當天 QQQ 收在 $708.93、跌幅 -1.51%</strong>，跌是有跌，但離原本 692 的行權價還有 <strong>約 17 點（≈ 2.4%）的安全距離</strong>，根本沒被逼到牆角。</p>

<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 560 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 現價與行權價距離示意" style="display:block;width:100%;height:auto;border-radius:10px;">
    <defs>
      <marker id="arrowEnd2" viewBox="0 0 10 10" refX="5" refY="9" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 0 L 5 10 z" fill="#4b5563"/></marker>
      <marker id="arrowStart2" viewBox="0 0 10 10" refX="5" refY="1" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 10 L 10 10 L 5 0 z" fill="#4b5563"/></marker>
    </defs>
    <rect x="0" y="0" width="560" height="340" fill="#fbf6ef" rx="10"/>
    <text x="24" y="32" font-size="14" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 5/15 收盤 vs 行權價</text>
    <line x1="40" y1="80" x2="380" y2="80" stroke="#22a37f" stroke-width="3"/>
    <text x="390" y="78" font-size="16" font-weight="700" fill="#22a37f" font-family="sans-serif">$708.93</text>
    <text x="390" y="96" font-size="11" fill="#557f70" font-family="sans-serif">5/15 收盤 (-1.51%)</text>
    <line x1="40" y1="225" x2="380" y2="225" stroke="#d97706" stroke-width="2.5" stroke-dasharray="6,4"/>
    <text x="390" y="223" font-size="16" font-weight="700" fill="#d97706" font-family="sans-serif">$692</text>
    <text x="390" y="241" font-size="11" fill="#8a6a3a" font-family="sans-serif">原 strike · May 15 PUT</text>
    <line x1="40" y1="285" x2="380" y2="285" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="6,4"/>
    <text x="390" y="283" font-size="16" font-weight="700" fill="#dc2626" font-family="sans-serif">$686</text>
    <text x="390" y="301" font-size="11" fill="#a04444" font-family="sans-serif">Roll 後 · May 18 PUT</text>
    <line x1="140" y1="84" x2="140" y2="221" stroke="#22a37f" stroke-width="1.5" marker-end="url(#arrowEnd2)" marker-start="url(#arrowStart2)"/>
    <rect x="64" y="140" width="152" height="28" fill="#fff" stroke="#22a37f" stroke-width="1.2" rx="4"/>
    <text x="140" y="158" font-size="13" font-weight="700" fill="#22a37f" font-family="sans-serif" text-anchor="middle">≈ 17 點 安全距離</text>
    <line x1="270" y1="229" x2="270" y2="281" stroke="#dc2626" stroke-width="1.5" marker-end="url(#arrowEnd2)" marker-start="url(#arrowStart2)"/>
    <rect x="222" y="246" width="96" height="22" fill="#fff" stroke="#dc2626" stroke-width="1.2" rx="4"/>
    <text x="270" y="261" font-size="12" font-weight="700" fill="#dc2626" font-family="sans-serif" text-anchor="middle">多 6 點緩衝</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">原本就有 17 點安全距離了，再多 6 點緩衝其實邊際效用很低。</figcaption>
</figure>

<p>真的擔心，<em>少量地</em>往下調是合理的（例如 1-2 點），但一次拉 6 個點，明顯是「為了完全消除恐懼」，不是「為了風險管理」。</p>

<p>追求安全感沒錯，但要合理 — 不要變成驚弓之鳥，一調就調超多。每次都這樣，等於每次都在放棄權利金、提前承認自己看錯方向。長期下來，獲利空間會被自己一刀一刀削掉。</p>

<h3>關鍵判斷準則</h3>

<p>三選一的根本問題只有一個 — <strong>「現在這個行權價，我還願意接股嗎？」</strong></p>

<ul>
  <li><strong>願意</strong>：讓它指派，或 roll 一次保留能收 credit 的部位即可。</li>
  <li><strong>不願意</strong>：表示原始論點已經破壞，先平倉、不要再用 roll 累積部位。</li>
</ul>

<p>不要把 roll 當成「免費的逃生艙」。每次 roll 都是新的決策，要重新檢視標的、行權價、到期日的合理性。</p>

<blockquote><p><strong>底線：</strong>賣方最大的優勢不是時間價值，而是「拒絕接你不想要的股票」的紀律。</p></blockquote>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `INSERT INTO blog_posts (title, content, category, tags, published_at, author_id, created_at, updated_at)
VALUES ('${escape(title)}', '${escape(content)}', '${escape(category)}', '${escape(tags)}', '${publishedAt}', NULL, ${now}, ${now});`;

const sqlPath = 'scripts/.tmp-insert-blog.sql';
writeFileSync(sqlPath, sql, 'utf8');
console.log(`SQL written to ${sqlPath} (${sql.length} bytes)`);

// Insert into both production DBs (DB and DB_SCOTT), so admin sees it regardless of group
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
