/**
 * Configura o provedor de e-mail no banco (SiteConfig.email + Secret cifrado).
 *
 * Por que um script e não o `.env`: o mailer lê host/porta/usuario de
 * `SiteConfig.email.smtp` e a senha de app de `Secret['email.apiKey']`,
 * cifrada com AES-256-GCM. Variável de ambiente não configura e-mail aqui.
 *
 * Roda DENTRO do contêiner `api`, que já tem DATABASE_URL e ENCRYPTION_KEY:
 *
 *   docker compose exec -T \
 *     -e SMTP_HOST=... -e SMTP_PORT=465 -e SMTP_USER=... -e SMTP_PASS=... \
 *     api node /tmp/configurar-email.mjs
 *
 * Idempotente: rodar de novo só sobrescreve os mesmos campos.
 * Não imprime a senha — só diz quantos caracteres recebeu.
 */
import { getSiteConfig, saveSiteConfig } from '/app/dist/services/config.js';
import { SECRET_KEYS, setSecret } from '/app/dist/services/secrets.js';
import { prisma } from '/app/dist/db.js';

const env = process.env;

const host = (env.SMTP_HOST ?? '').trim();
const port = Number(env.SMTP_PORT ?? 465);
const user = (env.SMTP_USER ?? '').trim();
const pass = env.SMTP_PASS ?? '';
// Senha de app do Gmail vem com espaços na interface do Google; o SMTP
// os ignora, mas deixá-los quebra a comparação e polui o log.
const passLimpa = pass.replace(/\s+/g, '');

if (!host || !user || !passLimpa) {
  console.error('faltou SMTP_HOST, SMTP_USER ou SMTP_PASS');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`SMTP_PORT invalida: ${env.SMTP_PORT}`);
  process.exit(1);
}

// 465 = TLS direto; 587 = STARTTLS. O painel edita depois se for outro servidor.
const secure = port === 465;

// O nome do remetente e o endereco podem vir separados. Sem SMTP_FROM_NAME,
// usa o nome do produto — e nao um nome de outro projeto que apareceria na
// caixa de entrada do cliente.
const fromName = (env.SMTP_FROM_NAME ?? 'Codigo Vencedor').trim();
const fromEmail = (env.SMTP_FROM_EMAIL ?? user).trim();

const atual = await getSiteConfig();

await saveSiteConfig(
  {
    email: {
      ...atual.email,
      provider: 'smtp',
      fromName,
      fromEmail,
      smtp: { host, port, secure, user },
    },
  },
  'deploy',
);

await setSecret(SECRET_KEYS.emailApiKey, passLimpa, 'deploy');

console.log('e-mail configurado:');
console.log(`  provider  smtp`);
console.log(`  host      ${host}:${port} (secure=${secure})`);
console.log(`  user      ${user}`);
console.log(`  from      ${fromName} <${fromEmail}>`);
console.log(`  senha     gravada cifrada (${passLimpa.length} caracteres)`);

await prisma.$disconnect();
