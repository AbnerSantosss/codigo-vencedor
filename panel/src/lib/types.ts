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
  /**
   * Libera `POST /api/orders/:publicId/simulate-payment`, que marca o pedido
   * como pago sem dinheiro nenhum ter entrado — e dispara e-mail de acesso,
   * Conversions API e webhooks de saída como uma venda de verdade. Fica
   * desligada; ligar em produção é distribuir o produto de graça.
   */
  simulatedPaymentEnabled: boolean;
  /** Aceitar cupom digitado no checkout embutido. */
  couponsEnabled: boolean;
  /** Piso do valor cobrado depois do cupom, em centavos. */
  pixMinCents: number;
}

/* --------------------------------------------------------- Rastreamento -- *
 *
 * Cada plataforma é uma **lista**: o dono anuncia com mais de uma conta e
 * precisava de N containers do GTM e N pixels da Meta, cada pixel com o token
 * da conta dele. As chaves antigas (`gtmId`, `meta.pixelId`, …) continuam
 * existindo e valendo como legado — o servidor deriva a lista a partir delas
 * quando a lista está vazia, então a configuração antiga não vira lixo.
 *
 * As listas são opcionais no tipo de propósito: o painel e o servidor são
 * publicados em passos separados, e uma tela que quebra porque a chave nova
 * ainda não subiu é pior do que uma tela mostrando só o item legado.
 * -------------------------------------------------------------------------- */

export interface GtmContainer {
  id: string;
  label: string;
  active: boolean;
}

export interface MetaPixel {
  id: string;
  label: string;
  active: boolean;
  testEventCode: string;
  /** Por pixel: um pode ter `purchase` ligado e o outro não. */
  events: string[];
}

export interface Ga4Stream {
  measurementId: string;
  label: string;
  active: boolean;
}

export interface GoogleAdsConversion {
  conversionId: string;
  conversionLabel: string;
  label: string;
  active: boolean;
}

export interface Tracking {
  /** Legado: um container só. */
  gtmId: string;
  gtm?: { containers: GtmContainer[] };
  meta: { pixels?: MetaPixel[]; pixelId: string; testEventCode: string; events: string[] };
  ga4: { streams?: Ga4Stream[]; measurementId: string };
  googleAds: { conversions?: GoogleAdsConversion[]; conversionId: string; conversionLabel: string };
  tiktok: { pixelCode: string };
  kwai: { pixelId: string };
}

/**
 * O retrato de "o que está instalado", montado pelo servidor.
 *
 * `temToken`/`temApiSecret` são booleanos derivados das mesmas chaves que o
 * envio usa — nunca o valor do segredo. É o que deixa a tela dizer "este pixel
 * está sem token" (o estado em que nenhum evento sai) sem nunca ter o token.
 */
export interface TrackingInstalado {
  gtm: { id: string; label: string; active: boolean; origem: string }[];
  meta: {
    id: string;
    label: string;
    active: boolean;
    temToken: boolean;
    testEventCode: string;
    eventos: number;
  }[];
  ga4: { measurementId: string; label: string; active: boolean; temApiSecret: boolean }[];
  googleAds: { conversionId: string; conversionLabel: string; label: string; active: boolean }[];
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

export type GatewayId = 'mercadopago' | 'appmax' | 'static_pix' | 'fyhub';

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
  /** Inclui as chaves por instância: `meta.capiToken:<pixelId>`, `ga4.apiSecret:<id>`. */
  secrets: SecretsStatus;
  availableEvents: { id: string; label: string; meta: string }[];
  /** Opcional: com um servidor mais antigo a tela remonta o retrato sozinha. */
  instalado?: TrackingInstalado;
}

export interface MetaTestResponse {
  ok: boolean;
  detail?: string;
  message?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------ Dashboard -- */

/**
 * Etapa do funil contada na tabela de eventos.
 *
 * `total` são disparos e `sessions` são pessoas distintas: uma pessoa que
 * recarrega a página cinco vezes é uma sessão e cinco `page_view`. Os dois
 * números aparecem no cartão porque o dono usa um para volume de tráfego e
 * o outro para tamanho de audiência.
 */
export interface FunnelStepMetric {
  total: number;
  sessions: number;
  deltaAbs: number;
}

/**
 * Os cinco indicadores da faixa "Funil do site" do dashboard.
 *
 * Abandono e Pix não têm `sessions`: são contagens de registro (rascunho de
 * checkout, pedido Pix), não de sessão — contar "sessões que abandonaram"
 * daria número diferente do que a tela de Recuperação lista, e duas telas
 * discordando sobre o mesmo abandono já custou uma manhã aqui.
 */
export interface FunnelMetrics {
  pageViews: FunnelStepMetric;
  checkoutsOpened: FunnelStepMetric;
  checkoutsAbandoned: { value: number; recovered: number; deltaAbs: number };
  pixCreated: { value: number; deltaAbs: number };
  pixAbandoned: { value: number; deltaAbs: number };
}

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
  /**
   * Opcional de propósito.
   *
   * O painel e o servidor são publicados em passos separados; um dashboard
   * que quebra porque a chave nova ainda não subiu é pior do que um cartão
   * mostrando "—" por alguns minutos. O `funnel?` obriga a tela, no nível do
   * compilador, a tratar o caso em que o servidor é mais antigo que ela.
   */
  funnel?: FunnelMetrics;
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
  source: string | null;
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
  /** Id da linha — é por ele que se pede o payload em `/events/:id`. */
  id: string;
  /** Id de deduplicação do evento (o mesmo que vai para a CAPI). */
  eventId: string;
  event: string;
  createdAt: string;
  page: string | null;
  referrer: string | null;
  /** Cortado em 8 caracteres pelo servidor: tela de depuração não identifica visitante. */
  sessionId: string | null;
  /** Chave do botão clicado. Só existe em `click` e `select_promotion`. */
  cta: string | null;
  /** O texto que a pessoa leu no botão, como estava na tela. */
  clickLabel: string | null;
  /** Seção da página onde o clique aconteceu. */
  clickSection: string | null;
  utm: Record<string, string> | null;
  params: Record<string, unknown> | null;
  /** Nome do evento de webhook correspondente, ou `null` quando não sai. */
  outboundEvent: string | null;
  /** Resultado do envio por plataforma — ex.: `{ meta: 'ok (1)' }`. */
  forwarded: Record<string, string> | null;
}

export interface EventsList {
  days: number;
  items: EventRow[];
  nextCursor: string | null;
}

/** Uma tentativa de entrega do evento em um webhook de saída. */
export interface EventDeliveryRow {
  id: string;
  webhookName: string;
  statusCode: number | null;
  attempt: number;
  deliveredAt: string | null;
  createdAt: string;
}

/**
 * `GET /events/:id` — o evento inteiro, do jeito que foi gravado.
 *
 * `payload` é literalmente o mesmo objeto que sai no corpo do webhook. Não é
 * uma reconstrução da tela: se o que o dono lê aqui divergisse do que o n8n
 * recebe, a tela viraria uma segunda fonte da verdade — e a primeira coisa
 * que se depura num webhook quebrado é justamente o corpo enviado.
 */
export interface EventDetail {
  event: {
    id: string;
    eventId: string;
    event: string;
    createdAt: string;
    sessionId: string | null;
    visitorId: string | null;
    leadId: string | null;
    orderId: string | null;
    cta: string | null;
    clickLabel: string | null;
    clickSection: string | null;
    page: string | null;
    referrer: string | null;
    ip: string | null;
    userAgent: string | null;
    utm: Record<string, string> | null;
    params: Record<string, unknown> | null;
    forwarded: Record<string, string> | null;
  };
  payload: Record<string, unknown>;
  outboundEvent: string | null;
  deliveries: EventDeliveryRow[];
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

/* ---------------------------------------------------------------- Cliques -- *
 *
 * De onde vem: `GET /api/admin/events/clicks`.
 *
 * `cliques` conta disparos e `pessoas` conta quem clicou — a diferença entre
 * os dois é o que revela alguém batendo cinco vezes no mesmo botão porque
 * nada aconteceu. Um botão com muitos cliques e poucas pessoas é um botão
 * quebrado, não um botão popular.
 * -------------------------------------------------------------------------- */

export interface ClickCount {
  cliques: number;
  pessoas: number;
}

export interface ClickButton extends ClickCount {
  /** Chave estável do botão — é por ela que o servidor agrupa. */
  cta: string;
  /** O rótulo lido na tela. Nulo em evento antigo, gravado antes das colunas. */
  label: string | null;
  section: string | null;
}

export interface ClickSection extends ClickCount {
  section: string;
}

export interface ClickPage extends ClickCount {
  page: string;
}

export interface ClicksSummary {
  days: number;
  total: ClickCount;
  buttons: ClickButton[];
  sections: ClickSection[];
  pages: ClickPage[];
}

/* -------------------------------------------------------------- Jornada -- *
 *
 * `GET /api/admin/events/journey?leadId=…` — a linha do tempo de uma pessoa,
 * em ordem crescente, juntando o que ela fez antes de virar lead (pelo
 * visitante e pela sessão) com o que fez depois.
 * -------------------------------------------------------------------------- */

export interface JourneyStep {
  id: string;
  event: string;
  cta: string | null;
  clickLabel: string | null;
  clickSection: string | null;
  page: string | null;
  referrer: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface JourneyResponse {
  lead: { id: string; nome: string | null; email: string | null; createdAt: string };
  items: JourneyStep[];
}

/* --------------------------------------------------------------- Cupons -- *
 *
 * O cupom é digitado pelo comprador e criado aqui. A página nunca decide
 * desconto: ela manda o código e o servidor devolve o valor.
 * -------------------------------------------------------------------------- */

export type CouponKind = 'percent' | 'fixed';

/** A conta já feita pelo servidor sobre o preço de hoje. */
export interface CouponPreview {
  code: string;
  kind: CouponKind;
  value: number;
  listAmountCents: number;
  discountCents: number;
  amountCents: number;
  /** O desconto pedido era maior, mas parou no mínimo do Pix. */
  limitadoPeloMinimo: boolean;
}

export interface CouponRow {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  active: boolean;
  maxUses: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  preview: CouponPreview;
}

export interface CouponsResponse {
  couponsEnabled: boolean;
  priceCents: number;
  pixMinCents: number;
  coupons: CouponRow[];
}

export interface CouponUsageRow {
  code: string;
  pedidos: number;
  pagos: number;
  receitaCents: number;
  descontoCents: number;
}

export interface CouponUsageResponse {
  days: number;
  items: CouponUsageRow[];
}
