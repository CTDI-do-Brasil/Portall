import bcrypt from 'bcryptjs';

const password = 'Acesso@2025';
const saltRounds = 12;

bcrypt.hash(password, saltRounds).then(hash => {
    console.log('Senha:', password);
    console.log('Hash:', hash);
});
