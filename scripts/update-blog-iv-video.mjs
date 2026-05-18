// One-off script: UPDATE blog post #2 to point at the new R2 video + retitle.
// Usage: node scripts/update-blog-iv-video.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const postId = 2;
const title = '影片：期權賣方能長期獲利的根本原因';
const category = '選擇權知識';
const tags = JSON.stringify(['賣方', '長期獲利', '選擇權知識', '影片']);
const publishedAt = '2026-05-18';
const now = Math.floor(Date.now() / 1000);

const content = `<div style="margin:24px 0;">
  <video controls preload="metadata" style="width:100%;display:block;border-radius:10px;background:#000;">
    <source src="/api/blog-video/blog-videos/seller-edge.mp4" type="video/mp4" />
    您的瀏覽器不支援影片播放，請改用較新的 Chrome / Edge / Firefox。
  </video>
  <p style="text-align:center;color:#8a7864;font-size:0.875rem;font-style:italic;margin-top:10px;">影片：期權賣方能長期獲利的根本原因</p>
</div>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `UPDATE blog_posts SET
  title = '${escape(title)}',
  content = '${escape(content)}',
  category = '${escape(category)}',
  tags = '${escape(tags)}',
  published_at = '${publishedAt}',
  updated_at = ${now}
WHERE id = ${postId};`;

const sqlPath = 'scripts/.tmp-update-blog-iv.sql';
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

console.log('\n✅ Done. Refresh https://scott-agent.com/blog/2');
