import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Plus, Send, Trash2 } from 'lucide-react';
import {
  siGoogleads,
  siGoogleanalytics,
  siGoogletagmanager,
  siKuaishou,
  siMeta,
  siTiktok,
  type SimpleIcon,
} from 'simple-icons';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import type {
  Ga4Stream,
  GoogleAdsConversion,
  GtmContainer,
  MetaPixel,
  MetaTestResponse,
  Tracking,
  TrackingResponse,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldGrid,
  Input,
  SecretInput,
  ToggleRow,
  coletarSecrets,
  secretVazio,
  type SecretState,
} from '@/components/ui/form';
import {
  Actions,
  Badge,
  Callout,
  Card,
  Divider,
  ErrorState,
  GroupTitle,
  Loading,
} from '@/components/ui/layout';
import { SurfaceHeader } from '@/components/ui/surface';
import { SaveBar } from '@/components/ui/save-bar';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { JsonBlock } from '@/components/ui/json';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { chaves, useAcao } from '../hooks';

/* ==========================================================================
   Rastreamento

   O pedido do dono foi "vários pixels da Meta ou do Google, ou uma tag do
   GTM — **mas mostrar que existe**". A segunda metade é a que muda a tela:
   antes dela dava para ter um pixel cadastrado sem token e não perceber, e
   um pixel sem token não envia nada. Por isso a primeira coisa da página é o
   retrato do que está instalado, com contagem e estado, antes das abas.

   Cada plataforma virou lista (até 5). Os campos antigos (`gtmId`,
   `meta.pixelId`, …) continuam sendo enviados no PUT, preenchidos com o
   primeiro item **ativo** — é o que o servidor guarda como legado e o que
   qualquer código antigo ainda leia encontra correto.
   ========================================================================== */

const MAX_POR_PLATAFORMA = 5;

/* Os mesmos formatos do `trackingSchema` (`src/services/config.ts`). Copiados
   de propósito: validar no cliente evita a viagem até o 400, mas quem manda é
   o servidor — a tela não é a autoridade sobre o formato. */
const RE_GTM = /^GTM-[A-Z0-9]+$/;
const RE_PIXEL = /^\d{5,25}$/;
const RE_GA4 = /^G-[A-Z0-9]+$/;
const RE_ADS = /^AW-\d+$/;

/** Chave do segredo daquele pixel — a mesma que o servidor usa no envio. */
const chaveTokenMeta = (pixelId: string) => `meta.capiToken:${pixelId.trim()}`;
/** Idem para a API secret do Measurement Protocol daquela stream. */
const chaveSecretGa4 = (measurementId: string) => `ga4.apiSecret:${measurementId.trim()}`;

/* ------------------------------------------------------------------ *
 * Leitura tolerante
 *
 * O servidor já normaliza (lista vazia + campo legado preenchido vira lista
 * de um item). Repetimos aqui porque o painel e o servidor são publicados em
 * passos separados: com um servidor antigo a tela precisa continuar
 * mostrando o que existe, em vez de abrir em branco.
 * ------------------------------------------------------------------ */

function containersDe(t: Tracking): GtmContainer[] {
  const lista = t.gtm?.containers ?? [];
  if (lista.length) return lista.map((c) => ({ ...c }));
  const legado = (t.gtmId ?? '').trim();
  return legado ? [{ id: legado, label: 'Principal', active: true }] : [];
}

function pixelsDe(t: Tracking): MetaPixel[] {
  const lista = t.meta.pixels ?? [];
  if (lista.length) return lista.map((p) => ({ ...p, events: [...p.events] }));
  const legado = t.meta.pixelId.trim();
  return legado
    ? [
        {
          id: legado,
          label: 'Principal',
          active: true,
          testEventCode: t.meta.testEventCode,
          events: [...t.meta.events],
        },
      ]
    : [];
}

function streamsDe(t: Tracking): Ga4Stream[] {
  const lista = t.ga4.streams ?? [];
  if (lista.length) return lista.map((s) => ({ ...s }));
  const legado = t.ga4.measurementId.trim();
  return legado ? [{ measurementId: legado, label: 'Principal', active: true }] : [];
}

function conversoesDe(t: Tracking): GoogleAdsConversion[] {
  const lista = t.googleAds.conversions ?? [];
  if (lista.length) return lista.map((c) => ({ ...c }));
  const legado = t.googleAds.conversionId.trim();
  return legado
    ? [
        {
          conversionId: legado,
          conversionLabel: t.googleAds.conversionLabel,
          label: 'Principal',
          active: true,
        },
      ]
    : [];
}

/** O primeiro item ativo — é ele que alimenta os campos legados do PUT. */
function primeiroAtivo<T extends { active: boolean }>(lista: T[]): T | undefined {
  return lista.find((i) => i.active);
}

/**
 * "Este pixel tem token?" — do jeito que o servidor decide, não do valor.
 *
 * Mesma regra do envio (`src/routes/admin/tracking.ts`): a chave por pixel e,
 * faltando ela, a chave antiga sem sufixo. Assim a tela não acusa "sem token"
 * um pixel herdado que está funcionando pelo legado.
 */
function tokenSalvoDoPixel(res: TrackingResponse, pixelId: string): boolean {
  const id = pixelId.trim();
  if (!id) return false;
  const doServidor = res.instalado?.meta.find((m) => m.id === id);
  if (doServidor) return doServidor.temToken;
  return res.secrets[chaveTokenMeta(id)] === true || res.secrets['meta.capiToken'] === true;
}

function apiSecretSalvoDaStream(res: TrackingResponse, measurementId: string): boolean {
  const id = measurementId.trim();
  if (!id) return false;
  const doServidor = res.instalado?.ga4.find((s) => s.measurementId === id);
  if (doServidor) return doServidor.temApiSecret;
  return res.secrets[chaveSecretGa4(id)] === true || res.secrets['ga4.apiSecret'] === true;
}

/* ------------------------------------------------------------------ *
 * Validação no cliente — espelho do servidor
 * ------------------------------------------------------------------ */

function errosDeLista<T>(itens: T[], ler: (i: T) => string, re: RegExp, formato: string): (string | null)[] {
  const contagem = new Map<string, number>();
  for (const item of itens) {
    const id = ler(item).trim();
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }
  return itens.map((item) => {
    const id = ler(item).trim();
    if (!id) return 'Preencha ou remova esta linha.';
    if (!re.test(id)) return formato;
    /* Id repetido duplicaria cada evento, e conversão contada duas vezes
       estraga a otimização da campanha — o servidor recusa, a tela avisa
       antes. */
    if ((contagem.get(id) ?? 0) > 1) return 'Este id já está na lista.';
    return null;
  });
}

/** `2 pixels`, `1 pixel` — sem "1 pixel(s)" na cara do dono. */
const contar = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/**
 * Tira da resposta do teste qualquer campo com nome de credencial.
 *
 * A resposta da Graph API hoje não devolve o token — mas esta tela imprime o
 * objeto inteiro, e quem mexer no teste do servidor amanhã não vai lembrar
 * dessa regra. O filtro fica aqui, onde o dado é mostrado.
 */
function semSegredos(res: MetaTestResponse): Record<string, unknown> {
  const proibido = /token|secret|senha|password|authorization|access[_-]?key/i;
  const out: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(res)) {
    if (!proibido.test(chave)) out[chave] = valor;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Painel "o que está instalado"
 * ------------------------------------------------------------------ */

interface ItemResumo {
  texto: string;
  tom: 'paid' | 'danger' | 'neutral' | 'info';
}

interface LinhaResumo {
  chave: string;
  nome: string;
  icone: SimpleIcon;
  contagem: string;
  itens: ItemResumo[];
}

function montarResumo(res: TrackingResponse): { linhas: LinhaResumo[]; alertas: string[]; vazio: boolean } {
  const t = res.tracking;

  /* `instalado` é o retrato que o servidor monta. Sem ele — painel publicado
     antes do servidor — o mesmo retrato é remontado do `tracking` com o mapa
     de segredos, para a tela nunca abrir em branco. */
  const gtm = res.instalado?.gtm ?? containersDe(t);
  const meta =
    res.instalado?.meta ??
    pixelsDe(t).map((p) => ({
      id: p.id,
      label: p.label,
      active: p.active,
      temToken: tokenSalvoDoPixel(res, p.id),
      testEventCode: p.testEventCode,
      eventos: p.events.length,
    }));
  const ga4 =
    res.instalado?.ga4 ??
    streamsDe(t).map((s) => ({
      measurementId: s.measurementId,
      label: s.label,
      active: s.active,
      temApiSecret: apiSecretSalvoDaStream(res, s.measurementId),
    }));
  const ads = res.instalado?.googleAds ?? conversoesDe(t);

  const gtmAtivos = gtm.filter((c) => c.active).length;
  const metaAtivos = meta.filter((m) => m.active).length;
  const ga4Ativos = ga4.filter((s) => s.active).length;
  /* "Sem token" conta só o que está ativo — é o que a etiqueta vermelha marca
     logo abaixo, e é o único caso em que falta token quebra alguma coisa.
     Contar o pixel desligado junto fazia a linha discordar das etiquetas. */
  const metaSemToken = meta.filter((m) => m.active && !m.temToken);
  const ga4SemSecret = ga4.filter((s) => s.active && !s.temApiSecret);

  /* Os estados que fazem o evento simplesmente não sair. São exatamente os
     que passavam despercebidos antes deste painel. */
  const alertas: string[] = [];
  if (metaSemToken.length) {
    alertas.push(
      `Pixel ativo sem token da CAPI não envia nada para a Meta: ${metaSemToken.map((m) => m.id).join(', ')}.`,
    );
  }
  if (ga4SemSecret.length) {
    alertas.push(
      `Stream do GA4 ativa sem API secret não recebe evento: ${ga4SemSecret.map((s) => s.measurementId).join(', ')}.`,
    );
  }
  if (gtm.length > 0 && gtmAtivos === 0) {
    alertas.push('Todos os containers do GTM estão inativos: nenhuma tag do GTM carrega na página.');
  }

  const linhas: LinhaResumo[] = [
    {
      chave: 'gtm',
      nome: 'Google Tag Manager',
      icone: siGoogletagmanager,
      contagem: gtm.length
        ? `${contar(gtm.length, 'container', 'containers')} · ${contar(gtmAtivos, 'ativo', 'ativos')}`
        : 'nenhum container cadastrado',
      itens: gtm.map((c) =>
        c.active
          ? ({ texto: c.id, tom: 'paid' } as const)
          : ({ texto: `${c.id} · inativo`, tom: 'neutral' } as const),
      ),
    },
    {
      chave: 'meta',
      nome: 'Meta (CAPI, servidor)',
      icone: siMeta,
      contagem: meta.length
        ? `${contar(meta.length, 'pixel', 'pixels')} · ${contar(metaAtivos, 'ativo', 'ativos')}` +
          (metaSemToken.length ? ` · ${metaSemToken.length} sem token` : '')
        : 'nenhum pixel cadastrado',
      itens: meta.map((m) =>
        !m.active
          ? ({ texto: `${m.id} · inativo`, tom: 'neutral' } as const)
          : !m.temToken
            ? ({ texto: `${m.id} · sem token`, tom: 'danger' } as const)
            : ({ texto: `${m.id} · token salvo`, tom: 'paid' } as const),
      ),
    },
    {
      chave: 'ga4',
      nome: 'Google Analytics 4',
      icone: siGoogleanalytics,
      contagem: ga4.length
        ? `${contar(ga4.length, 'stream', 'streams')} · ${contar(ga4Ativos, 'ativa', 'ativas')}` +
          (ga4SemSecret.length ? ` · ${ga4SemSecret.length} sem API secret` : '')
        : 'nenhuma stream cadastrada',
      itens: ga4.map((s) =>
        !s.active
          ? ({ texto: `${s.measurementId} · inativa`, tom: 'neutral' } as const)
          : !s.temApiSecret
            ? ({ texto: `${s.measurementId} · sem API secret`, tom: 'danger' } as const)
            : ({ texto: `${s.measurementId} · secret salvo`, tom: 'paid' } as const),
      ),
    },
    {
      chave: 'ads',
      nome: 'Google Ads',
      icone: siGoogleads,
      contagem: ads.length
        ? contar(ads.length, 'conversão cadastrada', 'conversões cadastradas')
        : 'nenhuma conversão cadastrada',
      itens: ads.map((c) =>
        c.active
          ? ({ texto: c.conversionId, tom: 'info' } as const)
          : ({ texto: `${c.conversionId} · inativa`, tom: 'neutral' } as const),
      ),
    },
  ];

  return {
    linhas,
    alertas,
    vazio: gtm.length === 0 && meta.length === 0 && ga4.length === 0 && ads.length === 0,
  };
}

function MarcaIcone({ icone }: { icone: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0 text-muted" aria-hidden>
      <path d={icone.path} />
    </svg>
  );
}

/**
 * Uma linha do retrato.
 *
 * No celular vira duas linhas empilhadas (nome em cima, contagem e etiquetas
 * embaixo); a partir de `sm` são duas colunas. O `min-w-0` em cada coluna não
 * é enfeite: etiqueta com `white-space: nowrap` dentro de uma grade empurra a
 * PÁGINA para o lado quando o item da grade não pode encolher.
 */
function LinhaInstalada({ linha }: { linha: LinhaResumo }) {
  return (
    <div className="grid min-w-0 gap-1.5 rounded-md border border-line bg-bg p-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <MarcaIcone icone={linha.icone} />
        <strong className="truncate text-sm">{linha.nome}</strong>
      </div>
      <div className="min-w-0">
        <p className="text-2xs text-muted">{linha.contagem}</p>
        {linha.itens.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {linha.itens.map((item) => (
              <Badge key={item.texto} tom={item.tom}>
                {item.texto}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cartão de uma linha editável
 * ------------------------------------------------------------------ */

function CartaoItem({
  titulo,
  etiqueta,
  onRemover,
  children,
}: {
  titulo: string;
  etiqueta?: React.ReactNode;
  onRemover: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-4 rounded-md border border-line bg-bg p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-2xs font-bold tracking-wider text-muted uppercase">{titulo}</span>
          {etiqueta}
        </div>
        {/* `min-h-11` = 44px: o `size="sm"` do painel é 40px, abaixo do piso de
            alvo de toque que o dono cobrou depois de errar botões no iPhone. */}
        <Button variant="danger" size="sm" className="min-h-11 md:min-h-9" onClick={onRemover}>
          <Trash2 />
          Remover
        </Button>
      </div>
      {children}
    </div>
  );
}

/* ================================================================== *
 * Tela
 * ================================================================== */

export function TelaRastreamento() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.tracking,
    queryFn: () => api<TrackingResponse>('/tracking'),
  });

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }
  return <Formulario key={JSON.stringify(data)} inicial={data} />;
}

/** O que a remoção precisa saber para perguntar a coisa certa. */
interface AlvoRemocao {
  tipo: 'gtm' | 'meta' | 'ga4' | 'ads';
  indice: number;
  titulo: string;
  /** Chave do segredo daquela linha, quando a plataforma tem uma. */
  chaveSegredo: string | null;
  /** O servidor já guarda um segredo desta linha? Só então oferecemos apagar. */
  temSegredoSalvo: boolean;
}

function Formulario({ inicial }: { inicial: TrackingResponse }) {
  const [containers, setContainers] = useState<GtmContainer[]>(() => containersDe(inicial.tracking));
  const [pixels, setPixels] = useState<MetaPixel[]>(() => pixelsDe(inicial.tracking));
  const [streams, setStreams] = useState<Ga4Stream[]>(() => streamsDe(inicial.tracking));
  const [conversoes, setConversoes] = useState<GoogleAdsConversion[]>(() => conversoesDe(inicial.tracking));
  const [tiktok, setTiktok] = useState(inicial.tracking.tiktok.pixelCode);
  const [kwai, setKwai] = useState(inicial.tracking.kwai.pixelId);

  const [segredos, setSegredos] = useState<Record<string, SecretState>>({});
  const [teste, setTeste] = useState<{ pixelId: string; res: MetaTestResponse } | null>(null);
  const [remover, setRemover] = useState<AlvoRemocao | null>(null);
  const [apagarSegredoJunto, setApagarSegredoJunto] = useState(false);

  const jaTem = (chave: string) => inicial.secrets[chave] === true;

  /* Quais ids já existem gravados no servidor: o teste da Meta usa o que está
     salvo, não o que está na tela. Sem isto o dono clicaria "testar" num pixel
     recém-digitado e receberia "nenhum pixel ativo com esse id". */
  const idsSalvosMeta = useMemo(
    () => new Set(pixelsDe(inicial.tracking).map((p) => p.id)),
    [inicial.tracking],
  );

  const resumo = useMemo(() => montarResumo(inicial), [inicial]);

  /* ---------------------------------------------------------- edição --- */

  const atualizarContainer = (i: number, patch: Partial<GtmContainer>) =>
    setContainers((l) => l.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const atualizarPixel = (i: number, patch: Partial<MetaPixel>) =>
    setPixels((l) => l.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const atualizarStream = (i: number, patch: Partial<Ga4Stream>) =>
    setStreams((l) => l.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const atualizarConversao = (i: number, patch: Partial<GoogleAdsConversion>) =>
    setConversoes((l) => l.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const alternarEvento = (i: number, evento: string, ligado: boolean) =>
    setPixels((l) =>
      l.map((p, idx) =>
        idx === i
          ? {
              ...p,
              events: ligado ? [...new Set([...p.events, evento])] : p.events.filter((e) => e !== evento),
            }
          : p,
      ),
    );

  /**
   * Move o que foi digitado no campo de credencial quando o id da linha muda.
   *
   * A chave do segredo carrega o id (`meta.capiToken:<id>`). Sem isto, trocar
   * o número do pixel depois de colar o token gravaria o token no id antigo —
   * e o pixel novo ficaria sem token, silenciosamente.
   */
  function trocarChaveSegredo(de: string, para: string) {
    if (de === para) return;
    setSegredos((m) => {
      const estado = m[de];
      if (!estado) return m;
      const copia = { ...m };
      delete copia[de];
      copia[para] = estado;
      return copia;
    });
  }

  /* -------------------------------------------------------- remoção --- */

  function pedirRemocao(alvo: AlvoRemocao) {
    setApagarSegredoJunto(false);
    setRemover(alvo);
  }

  function confirmarRemocao() {
    const alvo = remover;
    if (!alvo) return;

    const fora = <T,>(l: T[]) => l.filter((_, i) => i !== alvo.indice);
    if (alvo.tipo === 'gtm') setContainers(fora);
    if (alvo.tipo === 'meta') setPixels(fora);
    if (alvo.tipo === 'ga4') setStreams(fora);
    if (alvo.tipo === 'ads') setConversoes(fora);

    if (alvo.chaveSegredo) {
      const chave = alvo.chaveSegredo;
      setSegredos((m) => {
        const copia = { ...m };
        /* Tirar a linha da lista e apagar a credencial são coisas diferentes.
           Sem pedido explícito, o que foi digitado nesta sessão é descartado
           (não faz sentido gravar token de um pixel que saiu) e o que está no
           servidor fica onde está. */
        if (apagarSegredoJunto && alvo.temSegredoSalvo) copia[chave] = { value: '', clear: true };
        else delete copia[chave];
        return copia;
      });
    }

    setRemover(null);
    setApagarSegredoJunto(false);
  }

  /* Credenciais marcadas para apagar cuja linha já saiu da lista: sem este
     aviso, "apagar o token junto" viraria uma exclusão invisível. */
  const segredosOrfaos = useMemo(() => {
    const vivas = new Set([
      ...pixels.map((p) => chaveTokenMeta(p.id)),
      ...streams.map((s) => chaveSecretGa4(s.measurementId)),
    ]);
    return Object.entries(segredos)
      .filter(
        ([chave, estado]) =>
          estado.clear &&
          (chave.startsWith('meta.capiToken:') || chave.startsWith('ga4.apiSecret:')) &&
          !vivas.has(chave),
      )
      .map(([chave]) => chave.split(':')[1] ?? chave);
  }, [segredos, pixels, streams]);

  /* ------------------------------------------------------ validação --- */

  const errosGtm = useMemo(
    () => errosDeLista(containers, (c) => c.id, RE_GTM, 'Formato esperado: GTM- seguido de letras e números.'),
    [containers],
  );
  const errosMeta = useMemo(
    () => errosDeLista(pixels, (p) => p.id, RE_PIXEL, 'O Pixel ID é só de dígitos (entre 5 e 25).'),
    [pixels],
  );
  const errosGa4 = useMemo(
    () => errosDeLista(streams, (s) => s.measurementId, RE_GA4, 'Formato esperado: G- seguido de letras e números.'),
    [streams],
  );
  const errosAds = useMemo(
    () => errosDeLista(conversoes, (c) => c.conversionId, RE_ADS, 'Formato esperado: AW- seguido de números.'),
    [conversoes],
  );

  const quantosErros = [...errosGtm, ...errosMeta, ...errosGa4, ...errosAds].filter(Boolean).length;

  /* --------------------------------------------------------- salvar --- */

  function montarCorpo(): Tracking {
    const gtmLimpos = containers.map((c) => ({
      id: c.id.trim().toUpperCase(),
      label: c.label.trim(),
      active: c.active,
    }));
    const pixelsLimpos = pixels.map((p) => ({
      id: p.id.trim(),
      label: p.label.trim(),
      active: p.active,
      testEventCode: p.testEventCode.trim(),
      events: p.events,
    }));
    const streamsLimpas = streams.map((s) => ({
      measurementId: s.measurementId.trim().toUpperCase(),
      label: s.label.trim(),
      active: s.active,
    }));
    const conversoesLimpas = conversoes.map((c) => ({
      conversionId: c.conversionId.trim().toUpperCase(),
      conversionLabel: c.conversionLabel.trim(),
      label: c.label.trim(),
      active: c.active,
    }));

    /* Os campos legados vão preenchidos com o primeiro item ATIVO — e vazios
       quando não há nenhum. Vazio importa: o servidor só deriva a lista a
       partir do legado quando a lista está vazia, então mandar o legado
       antigo de volta ressuscitaria o container que o dono acabou de apagar. */
    const gtmPrincipal = primeiroAtivo(gtmLimpos);
    const pixelPrincipal = primeiroAtivo(pixelsLimpos);
    const streamPrincipal = primeiroAtivo(streamsLimpas);
    const conversaoPrincipal = primeiroAtivo(conversoesLimpas);

    return {
      gtmId: gtmPrincipal?.id ?? '',
      gtm: { containers: gtmLimpos },
      meta: {
        pixels: pixelsLimpos,
        pixelId: pixelPrincipal?.id ?? '',
        testEventCode: pixelPrincipal?.testEventCode ?? '',
        events: pixelPrincipal?.events ?? [],
      },
      ga4: {
        streams: streamsLimpas,
        measurementId: streamPrincipal?.measurementId ?? '',
      },
      googleAds: {
        conversions: conversoesLimpas,
        conversionId: conversaoPrincipal?.conversionId ?? '',
        conversionLabel: conversaoPrincipal?.conversionLabel ?? '',
      },
      tiktok: { pixelCode: tiktok.trim() },
      kwai: { pixelId: kwai.trim() },
    };
  }

  const salvar = useAcao(
    () =>
      api<{ tracking: Tracking }>('/tracking', {
        method: 'PUT',
        body: { tracking: montarCorpo(), secrets: coletarSecrets(segredos) },
      }),
    { sucesso: 'Rastreamento salvo.', invalidar: [chaves.tracking, chaves.config] },
  );

  /* O `onSuccess` do gancho não recebe as variáveis da chamada, e o resultado
     precisa aparecer no cartão do pixel certo. A referência guarda quem foi. */
  const pixelEmTeste = useRef('');
  const testarMeta = useAcao(
    (vars: { pixelId: string }) =>
      api<MetaTestResponse>('/tracking/meta/test', { method: 'POST', body: vars }),
    { onSuccess: (res) => setTeste({ pixelId: pixelEmTeste.current, res }) },
  );

  const sujo = useMemo(() => {
    const iguais =
      JSON.stringify([containers, pixels, streams, conversoes, tiktok, kwai]) ===
      JSON.stringify([
        containersDe(inicial.tracking),
        pixelsDe(inicial.tracking),
        streamsDe(inicial.tracking),
        conversoesDe(inicial.tracking),
        inicial.tracking.tiktok.pixelCode,
        inicial.tracking.kwai.pixelId,
      ]);
    return !iguais || coletarSecrets(segredos) !== undefined;
  }, [containers, pixels, streams, conversoes, tiktok, kwai, segredos, inicial.tracking]);

  const botaoSalvar = (
    <SaveBar
      inset={false}
      dirty={sujo}
      saving={salvar.isPending}
      disabled={quantosErros > 0}
      onSave={() => salvar.mutate(undefined)}
      saveLabel="Salvar rastreamento"
      message={
        quantosErros > 0
          ? `Corrija ${contar(quantosErros, 'campo marcado', 'campos marcados')} para salvar.`
          : sujo
            ? 'Alterações não salvas — salva as três abas de uma vez.'
            : 'Tudo salvo. O botão salva as três abas de uma vez.'
      }
    />
  );

  return (
    <>
      {/* ------------------------------------------- o que está instalado --- */}
      <Card>
        <SurfaceHeader
          title="O que está instalado"
          hint="O retrato do que está gravado no servidor agora — não do que está digitado na tela."
          action={sujo ? <Badge tom="pending">alterações não salvas</Badge> : null}
        />

        {resumo.vazio ? (
          <Callout tom="info">
            <strong>Nada de rastreamento está configurado.</strong> Sem container do GTM, o carregador
            do GTM não é injetado na página; sem pixel <em>e</em> token da CAPI, nenhum evento sai para
            a Meta. <strong>A medição do funil no Dashboard e na tela Eventos não depende disto</strong>{' '}
            — ela é do próprio site, de primeira parte, e continua funcionando com tudo aqui em branco.
          </Callout>
        ) : (
          <>
            <div className="grid gap-2.5">
              {resumo.linhas.map((linha) => (
                <LinhaInstalada key={linha.chave} linha={linha} />
              ))}
            </div>
            {resumo.alertas.length ? (
              <Callout tom="warn" className="mt-4 mb-0">
                <ul className="grid gap-1">
                  {resumo.alertas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}
          </>
        )}

        {segredosOrfaos.length ? (
          <Callout tom="warn" className="mt-4 mb-0">
            Ao salvar, a credencial guardada destes itens removidos <strong>também será apagada</strong>:{' '}
            {segredosOrfaos.join(', ')}. Para manter a credencial, cancele com o botão do navegador
            (recarregue a tela) antes de salvar.
          </Callout>
        ) : null}

        {!inicial.instalado ? (
          <Callout tom="warn" className="mt-4 mb-0">
            O servidor ainda não devolveu o retrato pronto (<code>instalado</code>). A tela montou este
            resumo com o que ela mesma leu — confira depois que o servidor for publicado.
          </Callout>
        ) : null}

        <p className="mt-4 text-2xs text-muted">
          Nada disto alimenta o Dashboard nem a tela Eventos: aqueles números vêm da medição de
          primeira parte do próprio site e continuam certos mesmo sem pixel, sem GTM e sem token.
        </p>
      </Card>

      <Tabs defaultValue="meta">
        <TabsList variant="underline">
          <TabsTrigger value="meta">Meta (servidor)</TabsTrigger>
          <TabsTrigger value="gtm">Google Tag Manager</TabsTrigger>
          <TabsTrigger value="outras">Outras plataformas</TabsTrigger>
        </TabsList>

        {/* ----------------------------------------------------- Meta --- */}
        <TabsContent value="meta">
          <Card>
            <SurfaceHeader
              title="Meta — API de Conversões"
              hint="Os eventos saem daqui do servidor, não do navegador: não dependem de bloqueador de anúncio, aba fechada nem cookie de terceiro. O Purchase nasce no webhook do pagamento."
            />

            {pixels.length === 0 ? (
              <Callout tom="warn">
                Nenhum pixel cadastrado — nenhum evento sai para a Meta. Adicione pelo menos um e cole o
                token da API de Conversões dele.
              </Callout>
            ) : null}

            <div className="grid gap-3">
              {pixels.map((p, i) => {
                const erro = errosMeta[i];
                const id = p.id.trim();
                const salvoNoServidor = idsSalvosMeta.has(id);
                const temToken = tokenSalvoDoPixel(inicial, id);
                const chaveToken = chaveTokenMeta(id);
                const mostrandoTeste = teste !== null && teste.pixelId === id;

                return (
                  <CartaoItem
                    key={i}
                    titulo={`Pixel ${i + 1}`}
                    etiqueta={
                      !salvoNoServidor ? (
                        <Badge tom="info">novo · salve para valer</Badge>
                      ) : temToken ? (
                        <Badge tom="paid">token salvo</Badge>
                      ) : (
                        <Badge tom="danger">sem token</Badge>
                      )
                    }
                    onRemover={() =>
                      pedirRemocao({
                        tipo: 'meta',
                        indice: i,
                        titulo: `Pixel ${id || '(sem número)'}`,
                        chaveSegredo: id ? chaveToken : null,
                        temSegredoSalvo: jaTem(chaveToken),
                      })
                    }
                  >
                    <FieldGrid>
                      <Field label="Pixel ID (dataset)" error={erro} htmlFor={`pixel-${i}`}>
                        <Input
                          id={`pixel-${i}`}
                          inputMode="numeric"
                          maxLength={25}
                          placeholder="1234567890123456"
                          value={p.id}
                          aria-invalid={erro ? true : undefined}
                          onChange={(e) => {
                            const novo = e.target.value.replace(/\D/g, '');
                            trocarChaveSegredo(chaveTokenMeta(p.id), chaveTokenMeta(novo));
                            atualizarPixel(i, { id: novo });
                          }}
                        />
                      </Field>
                      <Field label="Rótulo" hint="Só para você diferenciar as contas." htmlFor={`pixel-lb-${i}`}>
                        <Input
                          id={`pixel-lb-${i}`}
                          maxLength={40}
                          placeholder="Conta principal"
                          value={p.label}
                          onChange={(e) => atualizarPixel(i, { label: e.target.value })}
                        />
                      </Field>
                      <Field
                        label="Código de teste"
                        hint="Só para a aba Testar eventos do Events Manager. Vazio em produção."
                        htmlFor={`pixel-tc-${i}`}
                      >
                        <Input
                          id={`pixel-tc-${i}`}
                          maxLength={32}
                          placeholder="TEST12345"
                          value={p.testEventCode}
                          onChange={(e) => atualizarPixel(i, { testEventCode: e.target.value })}
                        />
                      </Field>
                    </FieldGrid>

                    <ToggleRow
                      label="Enviar eventos para este pixel"
                      hint={p.active ? 'Recebe os eventos marcados abaixo.' : 'Fica guardado e não recebe nada.'}
                      checked={p.active}
                      onChange={(v) => atualizarPixel(i, { active: v })}
                    />

                    <SecretInput
                      label="Token da API de Conversões deste pixel"
                      hint="Events Manager › Configurações › Gerar token de acesso. O token fica guardado pelo número do pixel: trocar o número exige colar o token de novo."
                      isSet={jaTem(chaveToken)}
                      state={segredos[chaveToken] ?? secretVazio}
                      onChange={(s) => setSegredos((m) => ({ ...m, [chaveToken]: s }))}
                    />

                    {/* `<details>` nativo: com cinco pixels seriam trinta
                        interruptores abertos numa tela de celular. */}
                    <details className="group rounded-sm border border-line">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold [&::-webkit-details-marker]:hidden">
                        <span>
                          Eventos enviados · {p.events.length} de {inicial.availableEvents.length}
                        </span>
                        <ChevronDown
                          className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
                          aria-hidden
                        />
                      </summary>
                      <div className="grid gap-2.5 border-t border-line p-3 sm:grid-cols-2">
                        {inicial.availableEvents.map((ev) => (
                          <ToggleRow
                            key={ev.id}
                            label={ev.label}
                            hint={`Vai para a Meta como ${ev.meta}.`}
                            checked={p.events.includes(ev.id)}
                            onChange={(v) => alternarEvento(i, ev.id, v)}
                          />
                        ))}
                      </div>
                    </details>

                    {mostrandoTeste && teste ? (
                      <div className="grid gap-2">
                        <Callout tom={teste.res.ok ? 'ok' : 'err'} className="mb-0">
                          {teste.res.detail ??
                            teste.res.message ??
                            (teste.res.ok ? 'A Meta aceitou o evento de teste.' : 'A Meta recusou o evento.')}
                        </Callout>
                        <details className="group">
                          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-2xs font-semibold text-muted [&::-webkit-details-marker]:hidden">
                            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                            Resposta completa do servidor
                          </summary>
                          <JsonBlock value={semSegredos(teste.res)} label="Resposta do teste da Meta" />
                        </details>
                      </div>
                    ) : null}

                    <Actions className="mt-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 md:min-h-9"
                        disabled={!salvoNoServidor}
                        loading={testarMeta.isPending && testarMeta.variables?.pixelId === id}
                        onClick={() => {
                          pixelEmTeste.current = id;
                          testarMeta.mutate({ pixelId: id });
                        }}
                      >
                        <Send />
                        Enviar evento de teste
                      </Button>
                      <span className="text-2xs text-muted">
                        {salvoNoServidor
                          ? 'Chama a API de verdade e devolve o que a Meta respondeu.'
                          : 'Salve primeiro: o teste usa o que está gravado no servidor.'}
                      </span>
                    </Actions>
                  </CartaoItem>
                );
              })}
            </div>

            <Actions>
              <Button
                variant="ghost"
                onClick={() =>
                  setPixels((l) =>
                    l.length >= MAX_POR_PLATAFORMA
                      ? l
                      : [
                          ...l,
                          {
                            id: '',
                            label: '',
                            active: true,
                            testEventCode: '',
                            events: inicial.availableEvents.map((e) => e.id),
                          },
                        ],
                  )
                }
                disabled={pixels.length >= MAX_POR_PLATAFORMA}
              >
                <Plus />
                Adicionar pixel
              </Button>
              <span className="text-2xs text-muted">
                Até {MAX_POR_PLATAFORMA} pixels, cada um com o token da conta dele.
              </span>
            </Actions>

            <p className="mt-4 text-2xs text-muted">
              Cada evento leva o mesmo <code>event_id</code> que foi para o dataLayer. Se você montar uma
              tag de Pixel no GTM, use esse <code>event_id</code> como <code>eventID</code> dela — é o que
              faz a Meta tratar os dois como um evento só, em vez de contar a venda duas vezes.
            </p>
          </Card>
          {botaoSalvar}
        </TabsContent>

        {/* ------------------------------------------------------ GTM --- */}
        <TabsContent value="gtm">
          <Card>
            <SurfaceHeader
              title="Google Tag Manager"
              hint="O único identificador que chega ao HTML da página. Gatilhos e tags você monta dentro do GTM — foi assim que o dono pediu."
            />

            {containers.length === 0 ? (
              <Callout tom="info">
                Nenhum container cadastrado — o carregador do GTM não é injetado na página.
              </Callout>
            ) : null}

            <div className="grid gap-3">
              {containers.map((c, i) => {
                const erro = errosGtm[i];
                return (
                  <CartaoItem
                    key={i}
                    titulo={`Container ${i + 1}`}
                    etiqueta={c.active ? null : <Badge tom="neutral">inativo</Badge>}
                    onRemover={() =>
                      pedirRemocao({
                        tipo: 'gtm',
                        indice: i,
                        titulo: `Container ${c.id.trim() || '(sem id)'}`,
                        chaveSegredo: null,
                        temSegredoSalvo: false,
                      })
                    }
                  >
                    <FieldGrid>
                      <Field label="Container ID" error={erro} htmlFor={`gtm-${i}`}>
                        <Input
                          id={`gtm-${i}`}
                          maxLength={32}
                          placeholder="GTM-XXXXXXX"
                          value={c.id}
                          aria-invalid={erro ? true : undefined}
                          onChange={(e) => atualizarContainer(i, { id: e.target.value.toUpperCase() })}
                        />
                      </Field>
                      <Field label="Rótulo" hint="Só para você diferenciar." htmlFor={`gtm-lb-${i}`}>
                        <Input
                          id={`gtm-lb-${i}`}
                          maxLength={40}
                          placeholder="Container principal"
                          value={c.label}
                          onChange={(e) => atualizarContainer(i, { label: e.target.value })}
                        />
                      </Field>
                    </FieldGrid>
                    <ToggleRow
                      label="Carregar na página"
                      hint={c.active ? 'A tag deste container entra no HTML.' : 'Fica guardado e não entra no HTML.'}
                      checked={c.active}
                      onChange={(v) => atualizarContainer(i, { active: v })}
                    />
                  </CartaoItem>
                );
              })}
            </div>

            <Actions>
              <Button
                variant="ghost"
                onClick={() =>
                  setContainers((l) =>
                    l.length >= MAX_POR_PLATAFORMA ? l : [...l, { id: '', label: '', active: true }],
                  )
                }
                disabled={containers.length >= MAX_POR_PLATAFORMA}
              >
                <Plus />
                Adicionar container
              </Button>
              <span className="text-2xs text-muted">Até {MAX_POR_PLATAFORMA} containers.</span>
            </Actions>

            <p className="mt-4 text-2xs text-muted">
              No HTML da página <strong>só entra a tag do GTM</strong>: gatilhos, pixels de navegador e
              tags você monta dentro do próprio GTM — é a regra fixada com o dono. Cada tag entra com o{' '}
              <code>nonce</code> da requisição, e as tags de HTML customizado criadas dentro do GTM
              herdam esse nonce automaticamente — é o que permite manter a CSP da LP sem{' '}
              <code>unsafe-inline</code>.
            </p>
          </Card>
          {botaoSalvar}
        </TabsContent>

        {/* --------------------------------------------------- Outras --- */}
        <TabsContent value="outras">
          <Card>
            <SurfaceHeader
              title="Outras plataformas"
              hint="GA4 recebe evento pelo servidor. Google Ads fica guardado para conferência, e TikTok e Kwai esperam o envio existir."
            />

            {/* ------------------------------------------------- GA4 --- */}
            <GroupTitle>Google Analytics 4</GroupTitle>
            <div className="grid gap-3">
              {streams.map((s, i) => {
                const erro = errosGa4[i];
                const id = s.measurementId.trim();
                const chave = chaveSecretGa4(id);
                return (
                  <CartaoItem
                    key={i}
                    titulo={`Stream ${i + 1}`}
                    etiqueta={
                      !s.active ? (
                        <Badge tom="neutral">inativa</Badge>
                      ) : apiSecretSalvoDaStream(inicial, id) ? (
                        <Badge tom="paid">secret salvo</Badge>
                      ) : (
                        <Badge tom="danger">sem API secret</Badge>
                      )
                    }
                    onRemover={() =>
                      pedirRemocao({
                        tipo: 'ga4',
                        indice: i,
                        titulo: `Stream ${id || '(sem id)'}`,
                        chaveSegredo: id ? chave : null,
                        temSegredoSalvo: jaTem(chave),
                      })
                    }
                  >
                    <FieldGrid>
                      <Field label="Measurement ID" error={erro} htmlFor={`ga4-${i}`}>
                        <Input
                          id={`ga4-${i}`}
                          maxLength={32}
                          placeholder="G-XXXXXXXXXX"
                          value={s.measurementId}
                          aria-invalid={erro ? true : undefined}
                          onChange={(e) => {
                            const novo = e.target.value.toUpperCase();
                            trocarChaveSegredo(chaveSecretGa4(s.measurementId), chaveSecretGa4(novo));
                            atualizarStream(i, { measurementId: novo });
                          }}
                        />
                      </Field>
                      <Field label="Rótulo" hint="Só para você diferenciar." htmlFor={`ga4-lb-${i}`}>
                        <Input
                          id={`ga4-lb-${i}`}
                          maxLength={40}
                          placeholder="Propriedade principal"
                          value={s.label}
                          onChange={(e) => atualizarStream(i, { label: e.target.value })}
                        />
                      </Field>
                    </FieldGrid>
                    <ToggleRow
                      label="Enviar eventos para esta stream"
                      checked={s.active}
                      onChange={(v) => atualizarStream(i, { active: v })}
                    />
                    <SecretInput
                      label="API Secret desta stream"
                      hint="Admin › Fluxos de dados › Measurement Protocol. Guardado pelo Measurement ID."
                      isSet={jaTem(chave)}
                      state={segredos[chave] ?? secretVazio}
                      onChange={(novo) => setSegredos((m) => ({ ...m, [chave]: novo }))}
                    />
                  </CartaoItem>
                );
              })}
            </div>
            <Actions>
              <Button
                variant="ghost"
                onClick={() =>
                  setStreams((l) =>
                    l.length >= MAX_POR_PLATAFORMA
                      ? l
                      : [...l, { measurementId: '', label: '', active: true }],
                  )
                }
                disabled={streams.length >= MAX_POR_PLATAFORMA}
              >
                <Plus />
                Adicionar stream
              </Button>
              <span className="text-2xs text-muted">Até {MAX_POR_PLATAFORMA} streams.</span>
            </Actions>

            <Divider />

            {/* ------------------------------------------ Google Ads --- */}
            <GroupTitle>Google Ads</GroupTitle>
            <Callout tom="info">
              A conversão do Google Ads <strong>entra por importação a partir do GA4</strong> (Ferramentas
              › Importar › Google Analytics), e não por envio direto daqui. Isto é desenho, não pendência:
              enviar também pela API do Ads contaria a mesma venda duas vezes. O que fica aqui é o
              cadastro, para conferência e para a importação apontar o par certo.
            </Callout>
            <div className="grid gap-3">
              {conversoes.map((c, i) => {
                const erro = errosAds[i];
                return (
                  <CartaoItem
                    key={i}
                    titulo={`Conversão ${i + 1}`}
                    etiqueta={c.active ? null : <Badge tom="neutral">inativa</Badge>}
                    onRemover={() =>
                      pedirRemocao({
                        tipo: 'ads',
                        indice: i,
                        titulo: `Conversão ${c.conversionId.trim() || '(sem id)'}`,
                        chaveSegredo: null,
                        temSegredoSalvo: false,
                      })
                    }
                  >
                    <FieldGrid>
                      <Field label="Conversion ID" error={erro} htmlFor={`ads-${i}`}>
                        <Input
                          id={`ads-${i}`}
                          maxLength={32}
                          placeholder="AW-123456789"
                          value={c.conversionId}
                          aria-invalid={erro ? true : undefined}
                          onChange={(e) => atualizarConversao(i, { conversionId: e.target.value.toUpperCase() })}
                        />
                      </Field>
                      <Field label="Conversion Label" htmlFor={`ads-cl-${i}`}>
                        <Input
                          id={`ads-cl-${i}`}
                          maxLength={64}
                          placeholder="AbC-D_efG"
                          value={c.conversionLabel}
                          onChange={(e) => atualizarConversao(i, { conversionLabel: e.target.value })}
                        />
                      </Field>
                      <Field label="Rótulo" hint="Só para você diferenciar." htmlFor={`ads-lb-${i}`}>
                        <Input
                          id={`ads-lb-${i}`}
                          maxLength={40}
                          placeholder="Compra aprovada"
                          value={c.label}
                          onChange={(e) => atualizarConversao(i, { label: e.target.value })}
                        />
                      </Field>
                    </FieldGrid>
                    <ToggleRow
                      label="Conversão em uso"
                      hint="Marcação de cadastro: o envio para o Ads continua sendo a importação do GA4."
                      checked={c.active}
                      onChange={(v) => atualizarConversao(i, { active: v })}
                    />
                  </CartaoItem>
                );
              })}
            </div>
            <Actions>
              <Button
                variant="ghost"
                onClick={() =>
                  setConversoes((l) =>
                    l.length >= MAX_POR_PLATAFORMA
                      ? l
                      : [...l, { conversionId: '', conversionLabel: '', label: '', active: true }],
                  )
                }
                disabled={conversoes.length >= MAX_POR_PLATAFORMA}
              >
                <Plus />
                Adicionar conversão
              </Button>
              <span className="text-2xs text-muted">Até {MAX_POR_PLATAFORMA} conversões.</span>
            </Actions>

            <Divider />

            {/* --------------------------------------- TikTok e Kwai --- */}
            <GroupTitle>TikTok e Kwai</GroupTitle>
            <Callout tom="warn">
              O envio pelo servidor hoje existe para <strong>Meta e GA4</strong>. TikTok e Kwai ficam
              guardados aqui: preencher não faz evento sair enquanto o envio não for implementado.
            </Callout>
            <div className="grid gap-6">
              <div className="grid gap-4">
                <div className="flex items-center gap-2">
                  <MarcaIcone icone={siTiktok} />
                  <strong className="text-sm">TikTok Ads</strong>
                </div>
                <FieldGrid>
                  <Field label="Pixel Code" htmlFor="tiktok">
                    <Input
                      id="tiktok"
                      maxLength={64}
                      placeholder="C4A1B2C3D4E5F6"
                      value={tiktok}
                      onChange={(e) => setTiktok(e.target.value)}
                    />
                  </Field>
                </FieldGrid>
                <SecretInput
                  label="Token da Events API"
                  isSet={jaTem('tiktok.accessToken')}
                  state={segredos['tiktok.accessToken'] ?? secretVazio}
                  onChange={(s) => setSegredos((m) => ({ ...m, 'tiktok.accessToken': s }))}
                />
              </div>

              <div className="grid gap-4">
                <div className="flex items-center gap-2">
                  <MarcaIcone icone={siKuaishou} />
                  <strong className="text-sm">Kwai Ads</strong>
                </div>
                <FieldGrid>
                  <Field label="Pixel ID" htmlFor="kwai">
                    <Input
                      id="kwai"
                      maxLength={64}
                      placeholder="ID do pixel"
                      value={kwai}
                      onChange={(e) => setKwai(e.target.value)}
                    />
                  </Field>
                </FieldGrid>
                <SecretInput
                  label="Token da API"
                  isSet={jaTem('kwai.accessToken')}
                  state={segredos['kwai.accessToken'] ?? secretVazio}
                  onChange={(s) => setSegredos((m) => ({ ...m, 'kwai.accessToken': s }))}
                />
              </div>
            </div>
          </Card>
          {botaoSalvar}
        </TabsContent>
      </Tabs>

      {/* Confirmação em modal, não `confirm()` do navegador: o diálogo nativo
          trava a automação e o projeto não usa. */}
      <Dialog
        open={remover !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setRemover(null);
            setApagarSegredoJunto(false);
          }
        }}
      >
        {remover ? (
          <DialogContent title="Remover da lista" description={remover.titulo}>
            <p className="text-sm text-ink-2">
              A linha sai da lista quando você salvar.
              {remover.temSegredoSalvo
                ? ' A credencial guardada no servidor não é apagada junto — remover a linha e apagar a credencial são coisas diferentes.'
                : ''}
            </p>
            {remover.temSegredoSalvo ? (
              <div className="mt-4">
                <ToggleRow
                  label="Apagar também a credencial guardada"
                  hint="Só marque se este número não vai voltar: apagar é definitivo e o token precisa ser colado de novo."
                  checked={apagarSegredoJunto}
                  onChange={setApagarSegredoJunto}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemover(null)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmarRemocao}>
                Remover
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
