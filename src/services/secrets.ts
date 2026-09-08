import { prisma } from '../db.js';
import { decrypt, encrypt } from './crypto.js';

/**
 * Credenciais de terceiros (gateway, pixels, e-mail).
 *
 * Ficam cifradas numa tabela própria, separadas do `SiteConfig`, por dois
 * motivos: o `SiteConfig` é lido em toda visita e vira JSON público, e
 * misturar segredo com configuração visual é como um token acaba vazando
 * num endpoint que ninguém revisou.
 *
 * Regra que vale para todo o painel: um segredo salvo **nunca** volta ao
 * navegador. A tela mostra "configurado" e um botão de substituir.
 */

export const SECRET_KEYS = {
  mpAccessToken: 'mp.accessToken',
  mpWebhookSecret: 'mp.webhookSecret',
  appmaxClientId: 'appmax.clientId',
  appmaxClientSecret: 'appmax.clientSecret',
  /**
   * Segredo que viaja na URL do webhook da Appmax (`?t=…`).
   *
   * Não é uma credencial deles: é nossa. A Appmax declara na documentação
   * que **não** assina as notificações — sem header de assinatura e sem
   * token. Como a URL é o único lugar onde podemos exigir prova, o segredo
   * mora nela, e a rota recusa qualquer notificação sem ele. Ver
   * `src/gateways/appmax.ts`.
   */
  appmaxWebhookToken: 'appmax.webhookToken',
  staticPixKey: 'pix.key',
  staticPixName: 'pix.merchantName',
  staticPixCity: 'pix.merchantCity',
  metaCapiToken: 'meta.capiToken',
  ga4ApiSecret: 'ga4.apiSecret',
  tiktokToken: 'tiktok.accessToken',
  kwaiToken: 'kwai.accessToken',
  emailApiKey: 'email.apiKey',
  emailSmtpUrl: 'email.smtpUrl',
} as const;

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];

/**
 * Cache em memória: o gateway lê estas chaves a cada cobrança.
 *
 * A invalidação explícita cobre o caso normal (o admin salvou). O TTL cobre
 * o resto: mais de uma réplica do serviço atrás do túnel, ou alguém mexendo
 * direto no banco. Sem ele, uma instância pode seguir usando uma credencial
 * removida — que foi exatamente o que aconteceu no primeiro teste.
 */
let cache: { map: Map<string, string>; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateSecretsCache(): void {
  cache = null;
}

async function loadAll(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  const rows = await prisma.secret.findMany();
  const map = new Map<string, string>();
  for (const row of rows) {
    try {
      map.set(row.key, decrypt(row.valueEnc));
    } catch {
      // Um segredo ilegível (chave trocada, registro corrompido) não pode
      // derrubar o servidor inteiro: ele some do mapa e a tela mostra
      // "não configurado", que é o comportamento seguro.
    }
  }
  cache = { map, at: Date.now() };
  return map;
}

export async function getSecret(key: SecretKey): Promise<string | null> {
  return (await loadAll()).get(key) ?? null;
}

export async function getSecrets(keys: SecretKey[]): Promise<Record<string, string | null>> {
  const all = await loadAll();
  return Object.fromEntries(keys.map((k) => [k, all.get(k) ?? null]));
}

export async function setSecret(key: SecretKey, value: string, updatedBy: string): Promise<void> {
  const trimmed = value.trim();

  if (!trimmed) {
    await prisma.secret.deleteMany({ where: { key } });
    invalidateSecretsCache();
    return;
  }

  await prisma.secret.upsert({
    where: { key },
    create: { key, valueEnc: encrypt(trimmed), updatedBy },
    update: { valueEnc: encrypt(trimmed), updatedBy },
  });
  invalidateSecretsCache();
}

/** O que o painel pode ver: quais chaves existem, nunca o conteúdo. */
export async function secretsStatus(keys: SecretKey[]): Promise<Record<string, boolean>> {
  const all = await loadAll();
  return Object.fromEntries(keys.map((k) => [k, all.has(k)]));
}
