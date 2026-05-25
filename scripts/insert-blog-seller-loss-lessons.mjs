// Insert "影片：期權虧損經驗分享" blog post.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const now = Math.floor(Date.now() / 1000);
const today = new Date().toISOString().slice(0, 10);

const title = '影片：期權虧損經驗分享';
const category = '影片';
const tags = JSON.stringify(['風險管理', '經驗', '影片']);
const content = `<div style="margin:24px 0;">
  <video controls preload="metadata" style="width:100%;display:block;border-radius:10px;background:#000;">
    <source src="/api/blog-video/blog-videos/seller-loss-lessons.mp4" type="video/mp4" />
    您的瀏覽器不支援影片播放，請改用較新的 Chrome / Edge / Firefox。
  </video>
</div>`;

const escape = (s) => s.replace(/'/g, "''");
const sql = `INSERT INTO blog_posts (title, content, category, tags, published_at, created_at, updated_at)
VALUES ('${escape(title)}', '${escape(content)}', '${escape(category)}', '${escape(tags)}', '${today}', ${now}, ${now});`;

const sqlPath = 'scripts/.tmp-insert-blog-seller-loss-lessons.sql';
writeFileSync(sqlPath, sql, 'utf8');

for (const db of ['scott-agent-production', 'scott-agent-scott-production']) {
  console.log(`\n--- Inserting into ${db} ---`);
  execSync(`npx wrangler d1 execute ${db} --remote --file=${sqlPath}`, { stdio: 'inherit' });
}

console.log('\n✅ Done. Refresh https://scott-agent.com/blog');
