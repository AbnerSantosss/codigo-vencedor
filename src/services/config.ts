import { z } from 'zod';
import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';
import { DEFAULT_TEMPLATES } from './emailTemplates.js';

/* ------------------------------------------------------------------ *
 * Schemas — o mesmo formato serve para validar o que o admin envia e
 * para descrever o que a LP recebe.
 * ------------------------------------------------------------------ */

export const contentSchema = z.object({
  priceCents: z.number().int().min(100).max(1_000_000),
  priceFromCents: z.number().int().min(100).max(10_000_000),
  currency: z.literal('BRL'),
  productName: z.string().min(1).max(120),
  videoEnabled: z.boolean(),
});

/** Cores da LP. Os nomes batem com os tokens --cv-* do lp.css. */
const colorToken = z
  .string()
  .regex(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i, 'Cor inválida')
  .max(64);

export const themeSchema = z.object({
  bg: colorToken,
  surface: colorToken,
  'surface-alt': colorToken,
  input: colorToken,
  'icon-bg': colorToken,
  border: colorToken,
  'border-strong': colorToken,
  accent: colorToken,
  'accent-hover': colorToken,
  'accent-soft': colorToken,
  'accent-ghost': colorToken,
  text: colorToken,
  'text-2': colorToken,
  'text-3': colorToken,
  muted: colorToken,
  'muted-2': colorToken,
  'muted-3': colorToken,
  danger: colorToken,
  /* Ação e urgência — separados da identidade (amarelo) de propósito. */
  cta: colorToken,
  'cta-hover': colorToken,
  'cta-ink': colorToken,
  'alert-bg': colorToken,
  'alert-ink': colorToken,
  radius: z.string().regex(/^\d{1,3}px$/),
});

export const scarcitySchema = z.object({
  countdown: z.object({
    enabled: z.boolean(),
    /** `per_visitor`: cada visitante tem o próprio prazo (não é oferta real).
     *  `campaign`: uma data/hora fim igual para todo mundo. */
    mode: z.enum(['per_visitor', 'campaign']),
    minutes: z.number().int().min(1).max(1440),
    endsAt: z.string().datetime().nullable(),
  }),
  spots: z.object({
    enabled: z.boolean(),
    /** `manual`: número fixo. `from_sales`: total menos os pedidos pagos. */
    mode: z.enum(['manual', 'from_sales']),
    value: z.number().int().min(0).max(9999),
  }),
  buyers: z.object({
    enabled: z.boolean(),
    /** `manual`: número fixo. `from_sales`: pedidos pagos nas últimas 24h. */
    mode: z.enum(['manual', 'from_sales']),
    value: z.number().int().min(0).max(99999),
  }),
  bar: z.object({ enabled: z.boolean() }),
  /**
   * Avisos de "acabou de comprar" que giram no canto da LP.
   *
   * Vive dentro de `scarcity` de propósito: `scarcity` já é uma coluna Json e
   * o `getSiteConfig` faz merge raso com o DEFAULT_CONFIG, então o bloco novo
   * ganha o default nas linhas que já existem no banco — nenhuma migration.
   *
   * A lista é digitada pelo dono. Vazia por padrão: nome de comprador não se
   * gera em código. No Brasil, aviso de compra que não aconteceu é o que o
   * art. 37 do CDC trata como publicidade enganosa.
   */
  socialProof: z.object({
    enabled: z.boolean(),
    /** Segundos entre um aviso e o próximo. */
    intervalSec: z.number().int().min(4).max(60),
    items: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          city: z.string().max(60),
          product: z.string().min(1).max(60),
          /** "há N min". 0 = não exibe o tempo. */
          minutesAgo: z.number().int().min(0).max(1440),
        }),
      )
      .max(20),
  }),
});

const optionalUrl = z.union([z.string().url(), z.literal('')]);

export const linksSchema = z.object({
  whatsapp: z.object({
    /** Só dígitos com DDI (ex.: 5511987654321) ou uma URL completa. */
    number: z.string().max(20),
    message: z.string().max(300),
  }),
  social: z.object({
    instagram: optionalUrl,
    tiktok: optionalUrl,
    kwai: optionalUrl,
    x: optionalUrl,
  }),
});

/**
 * Dois jeitos de vender:
 *  - `embedded`: o formulário e o QR Code ficam na própria página (maior
 *    conversão, exige gateway configurado);
 *  - `link`: os CTAs viram um botão que leva para um checkout externo
 *    (link de pagamento da Appmax, Hotmart, Kiwify...). Não exige gateway
 *    nenhum e serve para vender antes da integração ficar pronta.
 */
export const checkoutSchema = z.object({
  mode: z.enum(['embedded', 'link']),
  externalUrl: z.union([z.string().url(), z.literal('')]),
  buttonLabel: z.string().max(60),
  openInNewTab: z.boolean(),
});

export const trackingSchema = z.object({
  gtmId: z.union([z.string().regex(/^GTM-[A-Z0-9]+$/), z.literal('')]),
  meta: z.object({
    pixelId: z.string().max(32),
    testEventCode: z.string().max(32),
    /** Quais eventos do funil o servidor envia para a API de Conversões. */
    events: z.array(z.string()).max(20),
  }),
  ga4: z.object({ measurementId: z.string().max(32) }),
  googleAds: z.object({ conversionId: z.string().max(32), conversionLabel: z.string().max(64) }),
  tiktok: z.object({ pixelCode: z.string().max(64) }),
  kwai: z.object({ pixelId: z.string().max(64) }),
});

const templateSchema = z.object({
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(8000),
});

export const emailSchema = z.object({
  /** `smtp` cobre Gmail (senha de app) e qualquer servidor. `resend` fica
   *  reservado para quando o adaptador entrar. */
  provider: z.enum(['none', 'smtp', 'resend']),
  fromName: z.string().max(80),
  fromEmail: z.union([z.string().email(), z.literal('')]),
  smtp: z.object({
    host: z.string().max(200),
    port: z.number().int().min(1).max(65535),
    /** true = TLS direto (465). false = STARTTLS (587). */
    secure: z.boolean(),
    user: z.string().max(200),
  }),
  templates: z.object({
    purchase_approved: templateSchema,
    checkout_abandoned: templateSchema,
    pix_abandoned: templateSchema,
    password_reset: templateSchema,
    user_invite: templateSchema,
  }),
  /** Recuperação automática. Os prazos são em minutos depois do abandono. */
  recovery: z.object({
    checkoutAbandonedEnabled: z.boolean(),
    checkoutAbandonedAfterMin: z.number().int().min(5).max(1440),
    pixAbandonedEnabled: z.boolean(),
    pixAbandonedAfterMin: z.number().int().min(1).max(1440),
  }),
  /** Link que vai no e-mail de compra aprovada. Vazio = não inclui. */
  accessUrl: z.union([z.string().url(), z.literal('')]),
});

export const siteConfigSchema = z.object({
  content: contentSchema,
  theme: themeSchema,
  scarcity: scarcitySchema,
  links: linksSchema,
  checkout: checkoutSchema,
  tracking: trackingSchema,
  email: emailSchema,
  gatewayActive: z.enum(['mercadopago', 'appmax', 'static_pix']),
  gatewayMode: z.enum(['sandbox', 'production']),
  pixExpiresMin: z.number().int().min(5).max(1440),
});

export type SiteConfigData = z.infer<typeof siteConfigSchema>;

/* ------------------------------------------------------------------ *
 * Padrões — exatamente os valores do design original.
 * ------------------------------------------------------------------ */

export const DEFAULT_THEME: z.infer<typeof themeSchema> = {
  bg: '#070a08',
  surface: '#0c0f0d',
  'surface-alt': '#0a0d0b',
  input: '#141815',
  'icon-bg': '#1a1d16',
  border: '#1c211d',
  'border-strong': '#2a3129',
  accent: '#f5c518',
  'accent-hover': '#ffd84d',
  'accent-soft': 'rgba(245, 197, 24, .15)',
  'accent-ghost': 'rgba(245, 197, 24, .12)',
  text: '#ffffff',
  'text-2': '#e8ece8',
  'text-3': '#dfe5df',
  muted: '#c9d0c9',
  'muted-2': '#b8c0b8',
  'muted-3': '#9aa39a',
  danger: '#ff8a65',
  cta: '#22c55e',
  'cta-hover': '#4ade80',
  'cta-ink': '#04160a',
  'alert-bg': '#a51616',
  'alert-ink': '#ffffff',
  radius: '12px',
};

export const DEFAULT_CONFIG: SiteConfigData = {
  content: {
    priceCents: 2790,
    priceFromCents: 27390,
    currency: 'BRL',
    productName: 'Curso Código Vencedor + App',
    videoEnabled: true,
  },
  theme: DEFAULT_THEME,
  scarcity: {
    countdown: { enabled: true, mode: 'per_visitor', minutes: 15, endsAt: null },
    spots: { enabled: true, mode: 'manual', value: 7 },
    buyers: { enabled: true, mode: 'manual', value: 43 },
    bar: { enabled: true },
    socialProof: { enabled: false, intervalSec: 9, items: [] },
  },
  links: {
    whatsapp: { number: '', message: 'Olá! Tenho uma dúvida sobre o Código Vencedor.' },
    social: { instagram: '', tiktok: '', kwai: '', x: '' },
  },
  checkout: {
    mode: 'embedded',
    externalUrl: '',
    buttonLabel: 'Quero garantir minha vaga',
    openInNewTab: false,
  },
  tracking: {
    gtmId: '',
    meta: {
      pixelId: '',
      testEventCode: '',
      events: ['page_view', 'view_content', 'begin_checkout', 'generate_lead', 'add_payment_info', 'purchase'],
    },
    ga4: { measurementId: '' },
    googleAds: { conversionId: '', conversionLabel: '' },
    tiktok: { pixelCode: '' },
    kwai: { pixelId: '' },
  },
  email: {
    provider: 'none',
    fromName: 'Código Vencedor',
    fromEmail: '',
    // Padrões do Gmail: TLS direto na 465. Para outro servidor, o painel edita.
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: '' },
    templates: DEFAULT_TEMPLATES,
    recovery: {
      checkoutAbandonedEnabled: true,
      checkoutAbandonedAfterMin: 30,
      pixAbandonedEnabled: true,
      pixAbandonedAfterMin: 10,
    },
    accessUrl: '',
  },
  gatewayActive: 'static_pix',
  gatewayMode: 'sandbox',
  pixExpiresMin: 30,
};

/* ------------------------------------------------------------------ *
 * Leitura com cache
 *
 * /api/config é chamado por toda visita. Ler o Postgres a cada pageview
 * seria desperdício, então mantemos em memória por 60s e invalidamos na
 * hora em que o admin salva — assim a mudança aparece imediatamente para
 * quem salvou, sem custo no caminho quente.
 * ------------------------------------------------------------------ */

let cache: { data: SiteConfigData; at: number } | null = null;
const TTL_MS = 60_000;

export function invalidateConfigCache(): void {
  cache = null;
}

export async function getSiteConfig(): Promise<SiteConfigData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const row = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  if (!row) {
    cache = { data: DEFAULT_CONFIG, at: Date.now() };
    return DEFAULT_CONFIG;
  }

  // Merge com os padrões: se um campo novo for adicionado ao schema depois de
  // o registro já existir, ele ganha o default em vez de vir `undefined`.
  const data: SiteConfigData = {
    content: { ...DEFAULT_CONFIG.content, ...(row.content as object) },
    theme: { ...DEFAULT_CONFIG.theme, ...(row.theme as object) },
    scarcity: { ...DEFAULT_CONFIG.scarcity, ...(row.scarcity as object) },
    links: { ...DEFAULT_CONFIG.links, ...(row.links as object) },
    checkout: { ...DEFAULT_CONFIG.checkout, ...((row.checkout ?? {}) as object) },
    tracking: { ...DEFAULT_CONFIG.tracking, ...(row.tracking as object) },
    email: { ...DEFAULT_CONFIG.email, ...(row.email as object) },
    gatewayActive: row.gatewayActive,
    gatewayMode: row.gatewayMode,
    pixExpiresMin: row.pixExpiresMin,
  };

  cache = { data, at: Date.now() };
  return data;
}

export async function saveSiteConfig(patch: Partial<SiteConfigData>, updatedBy: string): Promise<SiteConfigData> {
  const current = await getSiteConfig();
  const next: SiteConfigData = { ...current, ...patch };

  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      content: next.content as unknown as Prisma.InputJsonValue,
      theme: next.theme as unknown as Prisma.InputJsonValue,
      scarcity: next.scarcity as unknown as Prisma.InputJsonValue,
      links: next.links as unknown as Prisma.InputJsonValue,
      checkout: next.checkout as unknown as Prisma.InputJsonValue,
      tracking: next.tracking as unknown as Prisma.InputJsonValue,
      email: next.email as unknown as Prisma.InputJsonValue,
      gatewayActive: next.gatewayActive,
      gatewayMode: next.gatewayMode,
      pixExpiresMin: next.pixExpiresMin,
      updatedBy,
    },
    update: {
      content: next.content as unknown as Prisma.InputJsonValue,
      theme: next.theme as unknown as Prisma.InputJsonValue,
      scarcity: next.scarcity as unknown as Prisma.InputJsonValue,
      links: next.links as unknown as Prisma.InputJsonValue,
      checkout: next.checkout as unknown as Prisma.InputJsonValue,
      tracking: next.tracking as unknown as Prisma.InputJsonValue,
      email: next.email as unknown as Prisma.InputJsonValue,
      gatewayActive: next.gatewayActive,
      gatewayMode: next.gatewayMode,
      pixExpiresMin: next.pixExpiresMin,
      updatedBy,
    },
  });

  invalidateConfigCache();
  return next;
}

/* ------------------------------------------------------------------ *
 * Projeção pública
 *
 * O que a LP recebe. Note o que NÃO está aqui: nenhum token, nenhuma
 * credencial, nenhuma configuração de e-mail. Só o que a página precisa
 * para se desenhar.
 * ------------------------------------------------------------------ */

export interface PublicConfig {
  priceCents: number;
  priceFromCents: number;
  currency: string;
  theme: Record<string, string>;
  scarcity: { countdown: boolean; spots: boolean; buyers: boolean; bar: boolean };
  countdown: { mode: string; minutes: number; endsAt: string | null };
  spots: number;
  buyers: number;
  /** Só sai daqui com a lista preenchida e o bloco ligado — ver scarcitySchema. */
  socialProof: {
    enabled: boolean;
    intervalSec: number;
    items: { name: string; city: string; product: string; minutesAgo: number }[];
  };
  whatsapp: { url: string; message: string };
  social: Record<string, string>;
  tracking: { gtmId: string };
  checkout: { mode: string; externalUrl: string; buttonLabel: string; openInNewTab: boolean; pollMs: number };
}

export async function getPublicConfig(live: { spots?: number; buyers?: number } = {}): Promise<PublicConfig> {
  const cfg = await getSiteConfig();

  const spots =
    cfg.scarcity.spots.mode === 'from_sales' && live.spots !== undefined ? live.spots : cfg.scarcity.spots.value;
  const buyers =
    cfg.scarcity.buyers.mode === 'from_sales' && live.buyers !== undefined ? live.buyers : cfg.scarcity.buyers.value;

  const social: Record<string, string> = {};
  for (const [key, url] of Object.entries(cfg.links.social)) {
    if (url) social[key] = url;
  }

  return {
    priceCents: cfg.content.priceCents,
    priceFromCents: cfg.content.priceFromCents,
    currency: cfg.content.currency,
    theme: cfg.theme,
    scarcity: {
      countdown: cfg.scarcity.countdown.enabled,
      spots: cfg.scarcity.spots.enabled,
      buyers: cfg.scarcity.buyers.enabled,
      bar: cfg.scarcity.bar.enabled,
    },
    countdown: {
      mode: cfg.scarcity.countdown.mode,
      minutes: cfg.scarcity.countdown.minutes,
      endsAt: cfg.scarcity.countdown.endsAt,
    },
    spots,
    buyers,
    /* Com o bloco desligado a LP recebe a lista vazia, não a lista escondida:
       o que não vai aparecer também não precisa viajar até o navegador. */
    socialProof: {
      enabled: cfg.scarcity.socialProof.enabled,
      intervalSec: cfg.scarcity.socialProof.intervalSec,
      items: cfg.scarcity.socialProof.enabled ? cfg.scarcity.socialProof.items : [],
    },
    whatsapp: { url: cfg.links.whatsapp.number, message: cfg.links.whatsapp.message },
    social,
    tracking: { gtmId: cfg.tracking.gtmId },
    checkout: {
      mode: cfg.checkout.mode,
      externalUrl: cfg.checkout.externalUrl,
      buttonLabel: cfg.checkout.buttonLabel,
      openInNewTab: cfg.checkout.openInNewTab,
      pollMs: 4000,
    },
  };
}
