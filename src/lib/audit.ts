import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { clientIp } from './security.js';

/** Campos que nunca devem entrar no log de auditoria em texto claro. */
const REDACTED = new Set([
  'password',
  'passwordHash',
  'accessToken',
  'clientSecret',
  'capiToken',
  'apiSecret',
  'secret',
  'webhookSecret',
  'pixKey',
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED.has(k) ? '«oculto»' : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Registra uma alteração feita no painel.
 *
 * Nunca lança: uma falha ao auditar não pode derrubar a operação que o
 * usuário pediu. O erro vai para o log do servidor e a vida segue.
 */
export async function audit(
  req: FastifyRequest,
  action: string,
  entity: string,
  entityId?: string | null,
  diff?: unknown,
  /**
   * Estado posterior, quando quem chama tem os dois lados em mãos.
   *
   * Com este parâmetro presente, `diff` passa a ser lido como "antes" e o
   * registro grava `{ de, para }` — que é o formato usado pelas telas de
   * config, gateway e rastreamento. As rotas de webhook chamavam com seis
   * argumentos desde a FASE 4 esperando exatamente isso, e a assinatura
   * ainda tinha cinco: `npm run build` quebrava. Aceitar o sexto (em vez de
   * apagar as chamadas) preserva a informação que elas queriam registrar.
   */
  depois?: unknown,
): Promise<void> {
  const registro = depois === undefined ? diff : { de: diff, para: depois };

  try {
    await prisma.auditLog.create({
      data: {
        userId: req.admin?.sub ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        diff: registro === undefined ? undefined : (redact(registro) as object),
        ip: clientIp(req, env.TRUST_CLOUDFLARE),
      },
    });
  } catch (err) {
    req.log.warn({ err, action, entity }, 'falha ao gravar auditoria');
  }
}
