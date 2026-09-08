/* ==========================================================================
   Contratos da API do painel

   Espelham `src/services/config.ts` e as rotas de `src/routes/admin/*`.
   Onde o servidor devolve booleano em vez de valor (credenciais), o tipo
   aqui é `boolean` de propósito: é a garantia, no nível do compilador, de
   que nenhuma tela tenta exibir um segredo que o servidor nunca manda.
   ========================================================================== */

export type Role = 'owner' | 'editor';

export interface Me {
  email: string;
  name: string | null;
  role: Role;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

/* ----------------------------------------------------------- SiteConfig -- */

export interface Content {
  priceCents: number;
  priceFromCents: number;
  currency: 'BRL';
  productName: string;
  videoEnabled: boolean;
}

export type Theme = Record<string, string>;

export interface SocialProofItem {
  name: string;
  city: string;
  product: string;
  minutesAgo: number;
}

export interface Scarcity {
  countdown: { enabled: boolean; mode: 'per_visitor' | 'campaign'; minutes: number; endsAt: string | null };
  spots: { enabled: boolean; mode: 'manual' | 'from_sales'; value: number };
  buyers: { enabled: boolean; mode: 'manual' | 'from_sales'; value: number };
  bar: { enabled: boolean };
  socialProof: { enabled: boolean; intervalSec: number; items: SocialProofItem[] };
}

export interface Links {
  whatsapp: { number: string; message: string };
  social: { instagram: string; tiktok: string; kwai: string; x: string };
}

export interface CheckoutCfg {
  mode: 'embedded' | 'link';
  externalUrl: string;
  buttonLabel: string;
  openInNewTab: boolean;
}

export interface Tracking {
  gtmId: string;
  meta: { pixelId: string; testEventCode: string; events: string[] };
  ga4: { measurementId: string };
  googleAds: { conversionId: string; conversionLabel: string };
  tiktok: { pixelCode: string };
  kwai: { pixelId: string };
}

export type TemplateId =
  | 'purchase_approved'
  | 'checkout_abandoned'
  | 'pix_abandoned'
  | 'password_reset'
  | 'user_invite';

export interface Template {
  subject: string;
  body: string;
}

export interface EmailCfg {
  provider: 'none' | 'smtp' | 'resend';
  fromName: string;
  fromEmail: string;
  smtp: { host: string; port: number; secure: boolean; user: string };
  templates: Record<TemplateId, Template>;
  recovery: {
    checkoutAbandonedEnabled: boolean;
    checkoutAbandonedAfterMin: number;
    pixAbandonedEnabled: boolean;
    pixAbandonedAfterMin: number;
  };
  accessUrl: string;
}

/** `GET /config` — sem `gatewayActive`/`gatewayMode`, que têm tela própria. */
export interface ConfigResponse {
  content: Content;
  theme: Theme;
  scarcity: Scarcity;
  links: Links;
  checkout: CheckoutCfg;
  tracking: Tracking;
  email: EmailCfg;
  pixExpiresMin: number;
  defaults: { theme: Theme; content: Content };
}

export type ConfigPatch = Partial<{
  content: Content;
  theme: Theme;
  scarcity: Scarcity;
  links: Links;
  checkout: CheckoutCfg;
  tracking: Tracking;
  email: EmailCfg;
  pixExpiresMin: number;
}>;

/* -------------------------------------------------------------- Gateway -- */

export type GatewayId = 'mercadopago' | 'appmax' | 'static_pix';

/** Mapa chave → "está configurado?". Nunca o valor. */
export type SecretsStatus = Record<string, boolean>;

export interface GatewayResponse {
  gatewayActive: GatewayId;
  gatewayMode: 'sandbox' | 'production';
  pixExpiresMin: number;
  secrets: SecretsStatus;
}

export interface GatewayTestResponse {
  ok: boolean;
  stage: string;
  detail: string;
  /** Presente quando o teste alcançou o provedor. */
  provider?: {
    id: GatewayId;
    label: string;
    account?: string | null;
    environment?: 'sandbox' | 'production' | 'desconhecido';
    mismatch?: boolean;
  };
}

/* ------------------------------------------------------------ Rastreio --- */

export interface TrackingResponse {
  tracking: Tracking;
  secrets: SecretsStatus;
  availableEvents: { id: string; label: string; meta: string }[];
}

export interface MetaTestResponse {
  ok: boolean;
  detail?: string;
  message?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------ Dashboard -- */

export interface MetricsSummary {
  days: number;
  revenue: { cents: number; grossCents: number; refundedCents: number; deltaPct: number | null };
  paidOrders: { value: number; deltaAbs: number };
  visits: { value: number; deltaAbs: number };
  conversion: { pct: number | null; deltaPp: number | null };
  averageTicketCents: number;
  pixPaidRate: { pct: number | null; paid: number; created: number };
  refunds: { count: number; cents: number };
  abandon: {
    drafts: number;
    expiredOrders: number;
    recoveryEmails: number;
    recovered: { count: number; cents: number };
  };
}

export interface DailySeries {
  days: number;
  series: { date: string; revenueCents: number; orders: number }[];
}

export interface SourcesResponse {
  days: number;
  sources: { source: string; sessions: number }[];
  total: number;
}

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'refunded' | 'failed';

export interface RecentOrder {
  publicId: string;
  reference: string;
  amountCents: number;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  provider: string;
  customer: string;
  email: string;
}

export interface EventsSummary {
  days: number;
  visits: number;
  funnel: { event: string; label: string; total: number; uniques: number; rate: number | null }[];
  sources: { source: string; sessions: number }[];
}

export interface EventRow {
  id: string;
  event: string;
  eventId: string | null;
  sessionId: string | null;
  page: string | null;
  referrer: string | null;
  utm: Record<string, string> | null;
  params: Record<string, unknown> | null;
  createdAt: string;
}

export interface EventsList {
  items: EventRow[];
  nextCursor: string | null;
}

/* ----------------------------------------------------------- Recuperação -- */

export interface RecoveryMark {
  at: string;
  status: string;
  error: string | null;
}

export interface RecoveryCheckoutRow {
  id: string;
  nome: string;
  email: string;
  startedAt: string;
  lastSeenAt: string;
  utm: Record<string, string> | null;
  ip: string | null;
  device: string;
  recovery: RecoveryMark | null;
}

export interface RecoveryPixRow {
  id: string;
  reference: string;
  amountCents: number;
  nome: string;
  email: string;
  fone: string | null;
  cpfLast3: string | null;
  generatedAt: string;
  expiredAt: string | null;
  utm: Record<string, string> | null;
  ip: string | null;
  device: string;
  recovery: RecoveryMark | null;
}

export interface RecoveryResponse {
  days: number;
  summary: {
    checkoutAbandoned: number;
    checkoutEmailed: number;
    pixAbandoned: number;
    pixEmailed: number;
    recovered: { count: number; cents: number };
    emails: Record<string, { enviado: number; falhou: number }>;
  };
  checkout: RecoveryCheckoutRow[];
  pix: RecoveryPixRow[];
}

/* ---------------------------------------------------------------- E-mail -- */

export interface EmailLogRow {
  id: string;
  to: string;
  template: string;
  provider: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface EmailResponse {
  email: EmailCfg;
  secrets: SecretsStatus;
  meta: Record<string, { label: string; hint: string; vars: string[] }>;
  defaults: Record<TemplateId, Template>;
  recent: EmailLogRow[];
}

/* -------------------------------------------------------------- Usuários -- */

export type UserStatus = 'ativo' | 'convite_enviado' | 'convite_expirado' | 'bloqueado';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  inviteSentAt: string | null;
  inviteExpiresAt: string | null;
}

export interface UsersResponse {
  me: string;
  users: UserRow[];
}

/* ------------------------------------------------------ Webhooks de saída -- */

export type MetodoWebhook = 'POST' | 'PUT' | 'PATCH';

export interface OutboundWebhook {
  id: string;
  name: string;
  url: string;
  method: MetodoWebhook;
  events: string[];
  headers: Record<string, string> | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Booleano: o segredo em si só sai na criação e na rotação. */
  hasSecret: boolean;
  entregas: number;
  ultimaEntregaAt: string | null;
  cartasMortas: number;
  avisoHttp: boolean;
}

export interface WebhooksResponse {
  /** Mapa `evento → rótulo` vindo de `EVENTOS_SAIDA`. */
  eventos: Record<string, string>;
  maxTentativas: number;
  webhooks: OutboundWebhook[];
}

export interface DeliveryRow {
  id: string;
  event: string;
  attempt: number;
  statusCode: number | null;
  resposta: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  reference: string | null;
  /** Sem entrega e sem próxima tentativa: parou de tentar. */
  morta: boolean;
}

export interface InboundRow {
  id: string;
  provider: string;
  eventType: string | null;
  externalId: string;
  receivedAt: string;
  processedAt: string | null;
  result: string | null;
  reference: string | null;
}

export interface TesteWebhookResponse {
  ok: boolean;
  statusCode: number | null;
  resposta: string | null;
  deliveryId?: string;
}
