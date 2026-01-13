const bcrypt = require('bcryptjs');

async function hashPassword() {
    const password = 'admin';
    const hash = await bcrypt.hash(password, 10);
    console.log('Password hash for admin:');
    console.log(hash);
}

hashPassword();
