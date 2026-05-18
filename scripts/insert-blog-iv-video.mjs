// One-off script: inserts blog post #2 (IV explainer video) into production blog_posts.
// Usage: node scripts/insert-blog-iv-video.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const title = '隱含波動率 IV 的來龍去脈';
const category = '選擇權知識';
const tags = JSON.stringify(['IV', '隱含波動率', '影片', '選擇權知識']);
const publishedAt = '2026-05-18';
const now = Math.floor(Date.now() / 1000);

const content = `<div style="margin:24px 0;">
  <video controls preload="metadata" style="width:100%;display:block;border-radius:10px;background:#000;">
    <source src="/api/blog-video/blog-videos/iv-explanation.mp4" type="video/mp4" />
    您的瀏覽器不支援影片播放，請改用較新的 Chrome / Edge / Firefox。
  </video>
  <p style="text-align:center;color:#8a7864;font-size:0.875rem;font-style:italic;margin-top:10px;">影片：隱含波動率 IV 的來龍去脈</p>
</div>`;

const escape = (s) => s.replace(/'/g, "''");

const sql = `INSERT INTO blog_posts (title, content, category, tags, published_at, author_id, created_at, updated_at)
VALUES ('${escape(title)}', '${escape(content)}', '${escape(category)}', '${escape(tags)}', '${publishedAt}', NULL, ${now}, ${now});`;

const sqlPath = 'scripts/.tmp-insert-blog-iv.sql';
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
