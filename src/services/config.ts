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

/* ------------------------------------------------------------------ *
 * Rastreamento
 *
 * A forma é uma **lista por plataforma**: N containers do GTM, N pixels da
 * Meta, N streams do GA4, N conversões do Google Ads. Um anunciante que roda
 * com agência costuma ter mais de um pixel na mesma página, e antes só cabia
 * um.
 *
 * Os campos antigos de item único continuam no schema de propósito. Removê-los
 * transformaria em lixo toda configuração já gravada — e `SiteConfig.tracking`
 * é `jsonb`, então não há DDL nem migration que avise. A leitura cai neles
 * quando a lista está vazia (ver `normalizarTracking`).
 *
 * O que NÃO está aqui, e é decisão, não esquecimento: nada disso vira tag no
 * HTML. No navegador só entra a tag do GTM; pixel de navegador o dono monta
 * dentro do GTM. Meta e GA4 recebem do servidor.
 * ------------------------------------------------------------------ */

/** Teto por plataforma. Não é limite técnico: é o que cabe numa tela e o que
 *  ainda faz sentido disparar em paralelo no caminho de uma venda. */
const MAX_POR_PLATAFORMA = 5;

/** Nome que o dono dá para não confundir dois pixels na tela. Vazio é válido. */
const rotuloSchema = z.string().max(40).default('');

/**
 * Dois itens com o mesmo id duplicariam cada evento enviado — e conversão
 * contada duas vezes estraga a otimização da campanha, que é pior do que
 * perder uma.
 */
function idsUnicos<T>(ler: (item: T) => string, campo: string) {
  return (lista: T[], ctx: z.RefinementCtx): void => {
    const vistos = new Set<string>();
    for (let i = 0; i < lista.length; i++) {
      const item = lista[i];
      if (item === undefined) continue;
      const id = ler(item);
      if (vistos.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, campo], message: `Id repetido: ${id}` });
      }
      vistos.add(id);
    }
  };
}

const gtmContainerSchema = z.object({
  id: z.string().regex(/^GTM-[A-Z0-9]+$/, 'ID de container inválido (esperado GTM-XXXXXXX)'),
  label: rotuloSchema,
  active: z.boolean().default(true),
});

const metaPixelSchema = z.object({
  /** O id do pixel é numérico. A faixa é folgada de propósito: a Meta já
   *  emitiu ids de 15 e de 16 dígitos e não promete o tamanho. */
  id: z.string().regex(/^\d{5,25}$/, 'Pixel ID inválido (apenas dígitos)'),
  label: rotuloSchema,
  active: z.boolean().default(true),
  testEventCode: z.string().max(32).default(''),
  /** Por pixel: um pode ter `purchase` ligado e o outro não. */
  events: z.array(z.string().max(40)).max(20).default([]),
});

const ga4StreamSchema = z.object({
  measurementId: z.string().regex(/^G-[A-Z0-9]+$/, 'Measurement ID inválido (esperado G-XXXXXXX)'),
  label: rotuloSchema,
  active: z.boolean().default(true),
});

const googleAdsConversionSchema = z.object({
  conversionId: z.string().regex(/^AW-\d+$/, 'ID de conversão inválido (esperado AW-000000000)'),
  conversionLabel: z.string().max(64).default(''),
  label: rotuloSchema,
  active: z.boolean().default(true),
});

/** Eventos que o servidor sabe traduzir para a Meta. Serve de padrão quando um
 *  pixel é cadastrado sem escolha explícita. */
export const EVENTOS_CAPI_PADRAO = [
  'page_view',
  'view_content',
  'begin_checkout',
  'generate_lead',
  'add_payment_info',
  'purchase',
];

export const trackingSchema = z.object({
  /** Legado: um container só. Mantido para configuração antiga não virar lixo. */
  gtmId: z
    .union([z.string().regex(/^GTM-[A-Z0-9]+$/), z.literal('')])
    .default(''),
  gtm: z
    .object({
      containers: z
        .array(gtmContainerSchema)
        .max(MAX_POR_PLATAFORMA, `No máximo ${MAX_POR_PLATAFORMA} containers`)
        .superRefine(idsUnicos<{ id: string }>((c) => c.id, 'id'))
        .default([]),
    })
    .default({}),
  meta: z
    .object({
      pixels: z
        .array(metaPixelSchema)
        .max(MAX_POR_PLATAFORMA, `No máximo ${MAX_POR_PLATAFORMA} pixels`)
        .superRefine(idsUnicos<{ id: string }>((p) => p.id, 'id'))
        .default([]),
      /* Legado — um pixel só, com o token único `meta.capiToken`. */
      pixelId: z.string().max(32).default(''),
      testEventCode: z.string().max(32).default(''),
      /** Quais eventos do funil o servidor envia para a API de Conversões. */
      events: z.array(z.string().max(40)).max(20).default([]),
    })
    .default({}),
  ga4: z
    .object({
      streams: z
        .array(ga4StreamSchema)
        .max(MAX_POR_PLATAFORMA, `No máximo ${MAX_POR_PLATAFORMA} streams`)
        .superRefine(idsUnicos<{ measurementId: string }>((s) => s.measurementId, 'measurementId'))
        .default([]),
      /* Legado. */
      measurementId: z.string().max(32).default(''),
    })
    .default({}),
  /**
   * Google Ads fica guardado e exibido, mas **não** tem envio direto daqui, e
   * isso é desenho, não pendência: a conversão do Ads entra por importação a
   * partir do GA4 (Ferramentas › Importar › Google Analytics). Enviar também
   * pela Enhanced Conversions API duplicaria a mesma venda nas duas contas.
   * Quem for mexer nisto depois: não "complete" o que falta aqui sem falar com
   * o dono — o que falta é intencional.
   */
  googleAds: z
    .object({
      conversions: z
        .array(googleAdsConversionSchema)
        .max(MAX_POR_PLATAFORMA, `No máximo ${MAX_POR_PLATAFORMA} conversões`)
        .superRefine(idsUnicos<{ conversionId: string }>((c) => c.conversionId, 'conversionId'))
        .default([]),
      /* Legado. */
      conversionId: z.string().max(32).default(''),
      conversionLabel: z.string().max(64).default(''),
    })
    .default({}),
  tiktok: z.object({ pixelCode: z.string().max(64).default('') }).default({}),
  kwai: z.object({ pixelId: z.string().max(64).default('') }).default({}),
});

export type TrackingConfig = z.infer<typeof trackingSchema>;

/* ------------------------------------------------------------------ *
 * Migração de leitura (não de escrita)
 * ------------------------------------------------------------------ */

const comoObjeto = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const comoTexto = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const comoLista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const comoBool = (v: unknown, padrao: boolean): boolean => (typeof v === 'boolean' ? v : padrao);

/**
 * Leitura tolerante do `tracking`.
 *
 * Uma instalação que já existe tem só `gtmId`/`meta.pixelId` preenchidos e
 * nenhuma lista. Em vez de rodar migração de dados — que exigiria alguém
 * executar um script no banco de produção para o painel voltar a funcionar —,
 * a conversão acontece **na leitura**: lista vazia com o campo legado
 * preenchido vira uma lista de um item. O primeiro PUT do painel grava a forma
 * nova e o legado fica parado onde está, sem apagar nada.
 *
 * Também é a garantia de tipo do resto do código: `SiteConfig.tracking` é
 * `jsonb` e ninguém valida o que veio do banco, então é aqui que
 * `cfg.tracking.meta.pixels` deixa de poder ser `undefined` em tempo de
 * execução enquanto o TypeScript jura que é um array.
 */
export function normalizarTracking(bruto: unknown): TrackingConfig {
  const raiz = comoObjeto(bruto);
  const gtmRaw = comoObjeto(raiz.gtm);
  const metaRaw = comoObjeto(raiz.meta);
  const ga4Raw = comoObjeto(raiz.ga4);
  const adsRaw = comoObjeto(raiz.googleAds);

  const gtmIdLegado = comoTexto(raiz.gtmId, 32);
  const pixelIdLegado = comoTexto(metaRaw.pixelId, 32);
  const testEventCodeLegado = comoTexto(metaRaw.testEventCode, 32);
  const eventosLegado = comoLista(metaRaw.events)
    .filter((e): e is string => typeof e === 'string')
    .slice(0, 20);
  const measurementIdLegado = comoTexto(ga4Raw.measurementId, 32);
  const conversionIdLegado = comoTexto(adsRaw.conversionId, 32);
  const conversionLabelLegado = comoTexto(adsRaw.conversionLabel, 64);

  const containers = comoLista(gtmRaw.containers)
    .map((item) => {
      const o = comoObjeto(item);
      return { id: comoTexto(o.id, 32), label: comoTexto(o.label, 40), active: comoBool(o.active, true) };
    })
    .filter((c) => c.id !== '')
    .slice(0, MAX_POR_PLATAFORMA);

  const pixels = comoLista(metaRaw.pixels)
    .map((item) => {
      const o = comoObjeto(item);
      const eventos = comoLista(o.events)
        .filter((e): e is string => typeof e === 'string')
        .slice(0, 20);
      return {
        id: comoTexto(o.id, 32),
        label: comoTexto(o.label, 40),
        active: comoBool(o.active, true),
        testEventCode: comoTexto(o.testEventCode, 32),
        events: eventos,
      };
    })
    .filter((p) => p.id !== '')
    .slice(0, MAX_POR_PLATAFORMA);

  const streams = comoLista(ga4Raw.streams)
    .map((item) => {
      const o = comoObjeto(item);
      return {
        measurementId: comoTexto(o.measurementId, 32),
        label: comoTexto(o.label, 40),
        active: comoBool(o.active, true),
      };
    })
    .filter((s) => s.measurementId !== '')
    .slice(0, MAX_POR_PLATAFORMA);

  const conversions = comoLista(adsRaw.conversions)
    .map((item) => {
      const o = comoObjeto(item);
      return {
        conversionId: comoTexto(o.conversionId, 32),
        conversionLabel: comoTexto(o.conversionLabel, 64),
        label: comoTexto(o.label, 40),
        active: comoBool(o.active, true),
      };
    })
    .filter((c) => c.conversionId !== '')
    .slice(0, MAX_POR_PLATAFORMA);

  /* A derivação só acontece com a lista vazia. Lista preenchida é a verdade:
     quem apagou o último pixel da lista não quer o legado de volta. */
  if (containers.length === 0 && gtmIdLegado) {
    containers.push({ id: gtmIdLegado, label: 'Principal', active: true });
  }
  if (pixels.length === 0 && pixelIdLegado) {
    pixels.push({
      id: pixelIdLegado,
      label: 'Principal',
      active: true,
      testEventCode: testEventCodeLegado,
      events: eventosLegado.length ? eventosLegado : [...EVENTOS_CAPI_PADRAO],
    });
  }
  if (streams.length === 0 && measurementIdLegado) {
    streams.push({ measurementId: measurementIdLegado, label: 'Principal', active: true });
  }
  if (conversions.length === 0 && conversionIdLegado) {
    conversions.push({
      conversionId: conversionIdLegado,
      conversionLabel: conversionLabelLegado,
      label: 'Principal',
      active: true,
    });
  }

  return {
    gtmId: gtmIdLegado,
    gtm: { containers },
    meta: {
      pixels,
      pixelId: pixelIdLegado,
      testEventCode: testEventCodeLegado,
      events: eventosLegado,
    },
    ga4: { streams, measurementId: measurementIdLegado },
    googleAds: { conversions, conversionId: conversionIdLegado, conversionLabel: conversionLabelLegado },
    tiktok: { pixelCode: comoTexto(comoObjeto(raiz.tiktok).pixelCode, 64) },
    kwai: { pixelId: comoTexto(comoObjeto(raiz.kwai).pixelId, 64) },
  };
}

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
    gtm: { containers: [] },
    meta: {
      pixels: [],
      pixelId: '',
      testEventCode: '',
      events: [...EVENTOS_CAPI_PADRAO],
    },
    ga4: { streams: [], measurementId: '' },
    googleAds: { conversions: [], conversionId: '', conversionLabel: '' },
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
    /* Não é merge raso como os outros: `tracking` virou lista e a forma antiga
       continua no banco. `normalizarTracking` faz o merge e a derivação do
       legado numa passada só — ver o comentário na própria função. */
    tracking: normalizarTracking(row.tracking),
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
  /**
   * `gtmIds` é a lista de containers **ativos**; `gtmId` continua sendo o
   * primeiro deles só para não quebrar quem já lê o campo antigo. Nenhum id de
   * pixel sai daqui: o pixel de navegador, quando existir, é o dono que monta
   * dentro do GTM, e a medição do funil não passa por nenhum dos dois.
   */
  tracking: { gtmId: string; gtmIds: string[] };
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

  /* Container desligado não viaja até o navegador: o que não vai carregar
     também não precisa aparecer numa resposta pública. */
  const gtmIds = cfg.tracking.gtm.containers.filter((c) => c.active).map((c) => c.id);

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
    tracking: { gtmId: gtmIds[0] ?? '', gtmIds },
    checkout: {
      mode: cfg.checkout.mode,
      externalUrl: cfg.checkout.externalUrl,
      buttonLabel: cfg.checkout.buttonLabel,
      openInNewTab: cfg.checkout.openInNewTab,
      pollMs: 4000,
    },
  };
}
