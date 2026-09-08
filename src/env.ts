import { z } from 'zod';

/**
 * Variáveis de ambiente validadas no boot. Se faltar algo obrigatório o
 * processo morre com uma mensagem clara — melhor do que subir e falhar
 * na primeira venda.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  /** URL pública, usada em e-mails, webhooks e no event_source_url das conversões. */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  /** Assina os JWT do admin. Trocar invalida todas as sessões. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),

  /**
   * Chave AES-256-GCM para CPF e credenciais de gateway/pixel.
   * 32 bytes em base64. Perder essa chave torna os segredos ilegíveis.
   */
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY precisa ser 32 bytes em base64'),

  /** Primeiro admin, criado pelo seed. Só é usado no primeiro boot. */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(10).optional(),

  /** Confiar no CF-Connecting-IP. Ligar só quando estiver atrás do túnel. */
  TRUST_CLOUDFLARE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nConfiguração inválida:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
