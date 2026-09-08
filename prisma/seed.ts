/**
 * Seed idempotente: pode rodar em todo deploy sem estragar nada.
 *
 * Cria (1) a configuração do site com os valores do design original e (2) o
 * primeiro administrador, a partir de ADMIN_EMAIL/ADMIN_PASSWORD. Se o admin
 * já existir, a senha NÃO é sobrescrita — senão um redeploy resetaria a senha
 * que o usuário escolheu.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_CONFIG } from '../src/services/config.js';

const prisma = new PrismaClient();

async function main() {
  /* ---------------- configuração do site ---------------- */
  const existingConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });

  if (!existingConfig) {
    await prisma.siteConfig.create({
      data: {
        id: 1,
        content: DEFAULT_CONFIG.content,
        theme: DEFAULT_CONFIG.theme,
        scarcity: DEFAULT_CONFIG.scarcity,
        links: DEFAULT_CONFIG.links,
        tracking: DEFAULT_CONFIG.tracking,
        email: DEFAULT_CONFIG.email,
        gatewayActive: DEFAULT_CONFIG.gatewayActive,
        gatewayMode: DEFAULT_CONFIG.gatewayMode,
        pixExpiresMin: DEFAULT_CONFIG.pixExpiresMin,
        updatedBy: 'seed',
      },
    });
    console.log('✔ SiteConfig criada com os padrões do designer');
  } else {
    console.log('· SiteConfig já existe, mantida como está');
  }

  /* ---------------- primeiro administrador ---------------- */
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('· ADMIN_EMAIL/ADMIN_PASSWORD não definidos — nenhum admin criado');
    return;
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`· Admin ${email} já existe, senha preservada`);
    return;
  }

  if (password.length < 12) {
    console.error('✖ ADMIN_PASSWORD precisa de pelo menos 12 caracteres');
    process.exitCode = 1;
    return;
  }

  await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'owner',
      // Obriga a trocar no primeiro acesso: a senha do .env passou por
      // variável de ambiente, log de deploy e histórico de shell.
      mustChangePassword: true,
    },
  });
  console.log(`✔ Admin ${email} criado (troca de senha obrigatória no primeiro login)`);
}

main()
  .catch((err) => {
    console.error('Falha no seed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
