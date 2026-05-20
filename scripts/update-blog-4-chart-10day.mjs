// Replace the 20-day COPX chart with a 10-day version (5/4 → 5/15).
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 4;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog4-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

// New 10-day chart: 5/4 → 5/15. Same y-scale (75-95), same strike lines (88 舊, 92 新).
const newFigure = `<figure style="margin:28px 0;padding:0;">
  <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="COPX 近 10 個交易日走勢與 5 日均線" style="display:block;width:100%;height:auto;border-radius:10px;">
    <rect x="0" y="0" width="720" height="280" fill="#fbf6ef" rx="10"/>
    <text x="20" y="24" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">COPX ／ 近 10 個交易日收盤 + 5 日均線</text>
    <line x1="498" y1="20" x2="518" y2="20" stroke="#22a37f" stroke-width="2.5"/>
    <text x="523" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">日收盤</text>
    <line x1="585" y1="20" x2="605" y2="20" stroke="#9bb0d4" stroke-width="2"/>
    <text x="610" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">5 日均線</text>
    <text x="42" y="56" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">95</text>
    <line x1="48" y1="52" x2="700" y2="52" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="101" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">90</text>
    <line x1="48" y1="97.5" x2="700" y2="97.5" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="147" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">85</text>
    <line x1="48" y1="143" x2="700" y2="143" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="192" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">80</text>
    <line x1="48" y1="188.5" x2="700" y2="188.5" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="238" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">75</text>
    <line x1="48" y1="234" x2="700" y2="234" stroke="#eee0d0" stroke-width="0.8"/>
    <line x1="48" y1="115.7" x2="700" y2="115.7" stroke="#a89580" stroke-width="1.2" stroke-dasharray="3,3"/>
    <text x="700" y="129" font-size="10" font-weight="600" fill="#8a7864" text-anchor="end" font-family="sans-serif">88 strike (舊)</text>
    <line x1="48" y1="79.3" x2="700" y2="79.3" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>
    <text x="700" y="74" font-size="11" font-weight="700" fill="#d97706" text-anchor="end" font-family="sans-serif">92 strike (新, +4)</text>
    <polyline points="334.4,175.7 405.6,155.8 476.7,133 547.8,117.8 618.9,105.5 690,110.8" fill="none" stroke="#9bb0d4" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="50,219 121.1,204.8 192.2,156 263.3,164.8 334.4,134.2 405.6,119.4 476.7,90.5 547.8,80.1 618.9,103.1 690,160.7" fill="none" stroke="#22a37f" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="618.9" cy="103.1" r="5" fill="#dc2626"/>
    <text x="618.9" y="92" font-size="11" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">$89.38</text>
    <circle cx="690" cy="160.7" r="3.5" fill="#5a4a35"/>
    <text x="690" y="180" font-size="10" font-weight="600" fill="#5a4a35" text-anchor="end" font-family="sans-serif">$83.05 (隔日)</text>
    <text x="50" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/4</text>
    <text x="121.1" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/5</text>
    <text x="192.2" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/6</text>
    <text x="263.3" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/7</text>
    <text x="334.4" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/8</text>
    <text x="405.6" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/11</text>
    <text x="476.7" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/12</text>
    <text x="547.8" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/13</text>
    <text x="618.9" y="255" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">5/14</text>
    <text x="690" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/15</text>
  </svg>
  <figcaption style="text-align:center;color:#8a7864;font-size:0.875rem;margin-top:10px;font-style:italic;">COPX 從 5/4 谷底 $76.65 衝高到 5/13 的 $91.91（+20%）。5/14 trade 當天收 $89.38（88C ITM $1.38），隔日 5/15 又跌回 $83.05（重新 OTM）。</figcaption>
</figure>`;

// Replace the entire <figure>...</figure> block at the top of the article.
const oldStart = '<figure style="margin:28px 0;padding:0;">\n  <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="COPX 近 20 個交易日走勢與 5 日均線"';
const idx = original.indexOf(oldStart);
if (idx === -1) {
  console.error('ERROR: hero chart opening not found.');
  process.exit(1);
}
const endMarker = '</figure>';
const endIdx = original.indexOf(endMarker, idx) + endMarker.length;
if (endIdx === -1 + endMarker.length) {
  console.error('ERROR: hero chart closing not found.');
  process.exit(1);
}
const updated = original.slice(0, idx) + newFigure + original.slice(endIdx);

console.log(`Replaced hero chart. Length delta: ${updated.length - original.length}`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-4-chart-10day.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/4');
