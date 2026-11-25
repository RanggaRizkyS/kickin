const bcrypt = require('bcryptjs');
(async () => {
  const password = process.argv[2];
  if (!password || password.length < 10) {
    console.error('Gunakan: npm run hash-admin-password -- "password-minimal-10-karakter"');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
})().catch(error => { console.error(error); process.exit(1); });
