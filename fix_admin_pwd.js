const bcrypt = require('bcryptjs');
const { execSync } = require('child_process');
const fs = require('fs');

async function main() {
    const hash = await bcrypt.hash('123456', 10);
    console.log('Generated hash:', hash);

    const sqlFile = 'C:/tmp/update_admin_pwd.sql';
    fs.writeFileSync(sqlFile, `UPDATE USERS SET password = '${hash}' WHERE email = 'admin';`);

    console.log('\nUpdating staging...');
    execSync(`npx wrangler d1 execute scott-agent-scott-staging --remote --file ${sqlFile}`, {
        cwd: process.cwd(),
        stdio: 'inherit'
    });

    console.log('\nUpdating production...');
    execSync(`npx wrangler d1 execute scott-agent-scott-production --remote --file ${sqlFile}`, {
        cwd: process.cwd(),
        stdio: 'inherit'
    });

    console.log('\nDone!');
}

main().catch(console.error);
