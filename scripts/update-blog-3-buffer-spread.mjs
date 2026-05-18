// Spread the two strike lines further apart in blog #3's buffer chart so
// the meta labels and the "5 點 / 0.7%" annotation no longer collide.
// It's a 示意 chart - true proportion is preserved by the chart's overall
// scale, not by the inter-strike gap.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);

const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

// Find the buffer chart SVG block and replace the geometry-dependent lines.
// We do it as a series of small replaces against the unique substrings.

const replacements = [
  // 651 strike line: y 240 -> 200
  ['<line x1="40" y1="240" x2="380" y2="240" stroke="#d97706"',
   '<line x1="40" y1="200" x2="380" y2="200" stroke="#d97706"'],
  // $651 text y: 238 -> 198
  ['<text x="390" y="238" font-size="16" font-weight="700" fill="#d97706"',
   '<text x="390" y="198" font-size="16" font-weight="700" fill="#d97706"'],
  // buffer 8.7% text y: 238 -> 198
  ['<text x="442" y="238" font-size="11" font-weight="600" fill="#8a6a3a"',
   '<text x="442" y="198" font-size="11" font-weight="600" fill="#8a6a3a"'],
  // 展期後 meta y: 256 -> 216
  ['<text x="390" y="256" font-size="11" fill="#8a6a3a"',
   '<text x="390" y="216" font-size="11" fill="#8a6a3a"'],

  // 646 strike line: y 270 -> 290
  ['<line x1="40" y1="270" x2="380" y2="270" stroke="#8a7864"',
   '<line x1="40" y1="290" x2="380" y2="290" stroke="#8a7864"'],
  // $646 text y: 268 -> 288
  ['<text x="390" y="268" font-size="16" font-weight="700" fill="#8a7864"',
   '<text x="390" y="288" font-size="16" font-weight="700" fill="#8a7864"'],
  // buffer 9.4% y: 268 -> 288
  ['<text x="442" y="268" font-size="11" font-weight="600" fill="#8a7864"',
   '<text x="442" y="288" font-size="11" font-weight="600" fill="#8a7864"'],
  // 原 strike meta y: 286 -> 306
  ['<text x="390" y="286" font-size="11" fill="#8a7864"',
   '<text x="390" y="306" font-size="11" fill="#8a7864"'],

  // Big arrow: y2 266 -> 286 (now ends just above the 646 line at y=290)
  ['<line x1="140" y1="84" x2="140" y2="266" stroke="#22a37f"',
   '<line x1="140" y1="84" x2="140" y2="286" stroke="#22a37f"'],

  // Small arrow between strikes: y1 244 -> 204, y2 266 -> 286
  ['<line x1="270" y1="244" x2="270" y2="266" stroke="#dc2626"',
   '<line x1="270" y1="204" x2="270" y2="286" stroke="#dc2626"'],
  // Small arrow label rect: y 246 -> 235 (centered between strikes)
  ['<rect x="225" y="246" width="90" height="20" fill="#fff" stroke="#dc2626"',
   '<rect x="225" y="235" width="90" height="20" fill="#fff" stroke="#dc2626"'],
  // Small arrow label text y: 259 -> 248
  ['<text x="270" y="259" font-size="11" font-weight="700" fill="#dc2626"',
   '<text x="270" y="248" font-size="11" font-weight="700" fill="#dc2626"'],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found:\n  ${oldStr}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Updated content: ${updated.length} chars (delta ${updated.length - original.length})`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-buffer-spread.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
