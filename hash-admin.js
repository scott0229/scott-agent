const bcrypt = require('bcryptjs');

async function hashAdminPassword() {
    const password = 'admin';
    const hash = await bcrypt.hash(password, 10);
    console.log('Password hash for admin:');
    console.log(hash);
}

hashAdminPassword();
