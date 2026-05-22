// One-off script: make the blog/5 chart taller (viewBox 280 -> 340, plot area 182 -> 238)
// so the 714 / 717 strike lines (3 points apart) are visually more separated.
// All y coordinates inside the SVG are recomputed for the new plot area.
// Usage: node scripts/update-blog-5-chart-taller.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 5;
const now = Math.floor(Date.now() / 1000);

const oldSvg = `<svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 近 20 個交易日走勢與 5 日均線" style="display:block;width:100%;height:auto;border-radius:10px;">
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
    <text x="52" y="78" font-size="11" font-weight="700" fill="#d97706" text-anchor="start" font-family="sans-serif">717 strike (新)</text>
    <polyline points="184.7,211.9 218.4,204.5 252.1,199.8 285.8,195.8 319.5,184.9 353.2,169.3 386.8,156.9 420.5,140.1 454.2,121.7 487.9,110.0 521.6,101.4 555.3,90.1 588.9,91.1 622.6,94.5 656.3,97.1 690,97.8" fill="none" stroke="#9bb0d4" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="50,230.8 83.7,202.4 117.4,201.6 151.1,216.8 184.7,207.7 218.4,193.6 252.1,179.1 285.8,182.0 319.5,162.1 353.2,129.9 386.8,131.8 420.5,94.7 454.2,90.0 487.9,103.8 521.6,86.8 555.3,75.2 588.9,99.9 622.6,106.9 656.3,116.8 690,90.3" fill="none" stroke="#22a37f" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="690" cy="90.3" r="5" fill="#dc2626"/>
    <text x="690" y="116" font-size="11" font-weight="700" fill="#dc2626" text-anchor="end" font-family="sans-serif">$713.15</text>
    <text x="50" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/23</text>
    <text x="218.4" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/30</text>
    <text x="386.8" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/7</text>
    <text x="555.3" y="255" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/14</text>
    <text x="690" y="255" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">5/20</text>
  </svg>`;

const newSvg = `<svg viewBox="0 0 720 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QQQ 近 20 個交易日走勢與 5 日均線" style="display:block;width:100%;height:auto;border-radius:10px;">
    <rect x="0" y="0" width="720" height="340" fill="#fbf6ef" rx="10"/>
    <text x="20" y="24" font-size="13" font-weight="700" fill="#5a4a35" font-family="sans-serif">QQQ ／ 近 20 個交易日收盤 + 5 日均線</text>
    <line x1="498" y1="20" x2="518" y2="20" stroke="#22a37f" stroke-width="2.5"/>
    <text x="523" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">日收盤</text>
    <line x1="585" y1="20" x2="605" y2="20" stroke="#9bb0d4" stroke-width="2"/>
    <text x="610" y="24" font-size="11" fill="#5a4a35" font-family="sans-serif">5 日均線</text>
    <text x="42" y="56" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">730</text>
    <line x1="48" y1="52" x2="700" y2="52" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="115.5" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">710</text>
    <line x1="48" y1="111.5" x2="700" y2="111.5" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="175" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">690</text>
    <line x1="48" y1="171" x2="700" y2="171" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="234.5" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">670</text>
    <line x1="48" y1="230.5" x2="700" y2="230.5" stroke="#eee0d0" stroke-width="0.8"/>
    <text x="42" y="294" font-size="10" fill="#a89580" text-anchor="end" font-family="sans-serif">650</text>
    <line x1="48" y1="290" x2="700" y2="290" stroke="#eee0d0" stroke-width="0.8"/>
    <line x1="48" y1="99.6" x2="700" y2="99.6" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="3,3"/>
    <text x="700" y="95.6" font-size="10" font-weight="600" fill="#dc2626" text-anchor="end" font-family="sans-serif">714 strike (盤中被穿)</text>
    <line x1="48" y1="90.7" x2="700" y2="90.7" stroke="#d97706" stroke-width="1.5" stroke-dasharray="6,4"/>
    <text x="52" y="86.7" font-size="11" font-weight="700" fill="#d97706" text-anchor="start" font-family="sans-serif">717 strike (新)</text>
    <polyline points="184.7,261.1 218.4,251.4 252.1,245.2 285.8,240.1 319.5,225.8 353.2,205.4 386.8,189.2 420.5,167.2 454.2,143.1 487.9,127.9 521.6,116.6 555.3,101.8 588.9,103.2 622.6,107.6 656.3,111.0 690,111.9" fill="none" stroke="#9bb0d4" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="50,285.8 83.7,248.7 117.4,247.7 151.1,267.5 184.7,255.6 218.4,237.2 252.1,218.2 285.8,221.9 319.5,196.0 353.2,153.8 386.8,156.3 420.5,107.8 454.2,101.7 487.9,119.7 521.6,97.5 555.3,82.4 588.9,114.7 622.6,123.8 656.3,136.7 690,102.1" fill="none" stroke="#22a37f" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="690" cy="102.1" r="5" fill="#dc2626"/>
    <text x="690" y="128" font-size="11" font-weight="700" fill="#dc2626" text-anchor="end" font-family="sans-serif">$713.15</text>
    <text x="50" y="311" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/23</text>
    <text x="218.4" y="311" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">4/30</text>
    <text x="386.8" y="311" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/7</text>
    <text x="555.3" y="311" font-size="10" fill="#8a7864" text-anchor="middle" font-family="sans-serif">5/14</text>
    <text x="690" y="311" font-size="10" font-weight="700" fill="#dc2626" text-anchor="middle" font-family="sans-serif">5/20</text>
  </svg>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `UPDATE blog_posts SET
  content = REPLACE(content, '${escape(oldSvg)}', '${escape(newSvg)}'),
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

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/5');
