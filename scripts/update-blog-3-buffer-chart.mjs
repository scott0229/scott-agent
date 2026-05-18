// Insert a strike-buffer chart (mirror of blog/1's layout) into blog #3.
// Visualizes the 5-point gap between 646 and 651 against the 67-point
// safety distance from current price.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const bufferChart = `<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 560 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 5/11 收盤與 646/651 strike 距離示意" style="display:block;width:100%;height:auto;border-radius:10px;">
    <defs>
      <marker id="arrB3End" viewBox="0 0 10 10" refX="5" refY="9" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 0 L 5 10 z" fill="#4b5563"/></marker>
      <marker id="arrB3Start" viewBox="0 0 10 10" refX="5" refY="1" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 10 L 10 10 L 5 0 z" fill="#4b5563"/></marker>
    </defs>
    <rect x="0" y="0" width="560" height="340" fill="#fbf6ef" rx="10"/>
    <text x="24" y="32" font-size="14" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 5/11 收盤 vs 行權價</text>
    <line x1="40" y1="80" x2="380" y2="80" stroke="#22a37f" stroke-width="3"/>
    <text x="390" y="78" font-size="16" font-weight="700" fill="#22a37f" font-family="sans-serif">$713.29</text>
    <text x="390" y="96" font-size="11" fill="#557f70" font-family="sans-serif">5/11 收盤</text>
    <line x1="40" y1="240" x2="380" y2="240" stroke="#d97706" stroke-width="2.5" stroke-dasharray="6,4"/>
    <text x="390" y="238" font-size="16" font-weight="700" fill="#d97706" font-family="sans-serif">$651</text>
    <text x="442" y="238" font-size="11" font-weight="600" fill="#8a6a3a" font-family="sans-serif">· buffer 8.7%</text>
    <text x="390" y="256" font-size="11" fill="#8a6a3a" font-family="sans-serif">展期後 · May'13 PUT</text>
    <line x1="40" y1="270" x2="380" y2="270" stroke="#8a7864" stroke-width="2" stroke-dasharray="4,4"/>
    <text x="390" y="268" font-size="16" font-weight="700" fill="#8a7864" font-family="sans-serif">$646</text>
    <text x="442" y="268" font-size="11" font-weight="600" fill="#8a7864" font-family="sans-serif">· buffer 9.4%</text>
    <text x="390" y="286" font-size="11" fill="#8a7864" font-family="sans-serif">原 strike · May'12 PUT</text>
    <line x1="140" y1="84" x2="140" y2="266" stroke="#22a37f" stroke-width="1.5" marker-end="url(#arrB3End)" marker-start="url(#arrB3Start)"/>
    <rect x="60" y="160" width="160" height="28" fill="#fff" stroke="#22a37f" stroke-width="1.2" rx="4"/>
    <text x="140" y="178" font-size="13" font-weight="700" fill="#22a37f" font-family="sans-serif" text-anchor="middle">≈ 67 點 / 9.4% buffer</text>
    <line x1="270" y1="244" x2="270" y2="266" stroke="#dc2626" stroke-width="1.5" marker-end="url(#arrB3End)" marker-start="url(#arrB3Start)"/>
    <rect x="225" y="246" width="90" height="20" fill="#fff" stroke="#dc2626" stroke-width="1.2" rx="4"/>
    <text x="270" y="259" font-size="11" font-weight="700" fill="#dc2626" font-family="sans-serif" text-anchor="middle">5 點 / 0.7%</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">原本就有 9.4% buffer，+5 上拉只少 0.7% — 防守上幾乎沒差。</figcaption>
</figure>`;

// Insert AFTER the </ul> that closes the 買回/再賣 bullets, BEFORE the next paragraph.
const anchor = `<li><strong>淨收</strong>：+0.9</li>
</ul>

<p>注意 +5 是一個<strong>主動選擇</strong>`;

const replacement = `<li><strong>淨收</strong>：+0.9</li>
</ul>

${bufferChart}

<p>注意 +5 是一個<strong>主動選擇</strong>`;

if (!original.includes(anchor)) {
  console.error('ERROR: insertion anchor not found. Aborting.');
  process.exit(1);
}
const updated = original.replace(anchor, replacement);
console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-buffer-chart.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
