// 1) Remove the 底線 blockquote (redundant with the 總結 callout).
// 2) Rename 總結 heading to make it case-specific.
import { writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 3;
const now = Math.floor(Date.now() / 1000);
const sourcePath = 'C:/Users/scott/blog3-content.html';
const original = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

const replacements = [
  // Rename heading
  ['🎯 總結：strike 移動的決策框架',
   '🎯 總結：此案例的展期行權價決策框架'],

  // Remove 底線 blockquote (include preceding blank line so we don't leave double newline).
  [`
<blockquote><p><strong>底線：</strong>展期是必須的；strike 移動是選擇題。沒有對應目的的 strike 移動就是 noise — 表面上多收 0.5、0.9，實質上是把 buffer 一點一點 ratchet 下去。賣方賺的是權利金，但更賺的是<strong>知道什麼時候該動、什麼時候不該動</strong>的紀律。</p></blockquote>`,
   ''],
];

let updated = original;
for (const [oldStr, newStr] of replacements) {
  if (!updated.includes(oldStr)) {
    console.error(`ERROR: substring not found: ${oldStr.slice(0, 80)}`);
    process.exit(1);
  }
  updated = updated.replace(oldStr, newStr);
}

console.log(`Applied ${replacements.length} replacements. Length delta: ${updated.length - original.length}`);
writeFileSync(sourcePath, updated, 'utf8');

const escape = (s) => s.replace(/'/g, "''");
const sql = `UPDATE blog_posts SET content = '${escape(updated)}', updated_at = ${now} WHERE id = ${postId};`;
const sqlPath = 'scripts/.tmp-update-blog-3-remove-bottomline.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Updating ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/3');
