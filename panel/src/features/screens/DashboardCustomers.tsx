import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Mail, MessageCircle, Route, Search } from 'lucide-react';
import { api, descreverErro } from '@/lib/api';
import { brl, quando } from '@/lib/format';
import { rotuloDoEvento } from '@/lib/eventos';
import type { JourneyResponse, JourneyStep } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, Empty, ErrorState, Loading } from '@/components/ui/layout';
import { Surface } from '@/components/ui/surface';
import { Segmented } from '@/components/ui/segmented';
import { Pagination } from '@/components/ui/pagination';
import { OriginBadge } from '@/components/ui/origin';
import { chaves } from '../hooks';

type Kind = 'paid' | 'draft' | 'expired';
interface CustomerList { total: number; page: number; size: number; rows: {
  id: string; name: string; email: string; phone: string | null; date: string;
  reference: string | null; amountCents: number | null; source: string | null; recoveryEmailAt: string | null;
}[] }

/* --------------------------------------------------------------- Jornada --
 *
 * "Onde foi que o lead clicou" só tem resposta completa quando os eventos
 * dele aparecem em ordem, um embaixo do outro. A tela de Cliques responde no
 * agregado — qual botão funciona; aqui é o caminho de uma pessoa só, que é o
 * que serve na hora de escrever para ela.
 *
 * O servidor casa os eventos por lead, por visitante e por sessão, então a
 * linha do tempo costuma começar antes do checkout: a visita que originou o
 * cadastro entra junto.
 * -------------------------------------------------------------------------- */

/** O que a pessoa tocou, quando o evento carrega essa informação. */
function ondeClicou(p: JourneyStep): string | null {
  const alvo = p.clickLabel ?? p.cta;
  if (!alvo) return null;
  return p.clickSection ? `${alvo} · ${p.clickSection}` : alvo;
}

/* O mesmo teto que a rota aplica. Repetido aqui só para avisar quando a
   lista foi cortada — sem o aviso, uma jornada truncada se parece com uma
   jornada curta. */
const PASSOS_MAX = 200;

function Jornada({ kind, id }: { kind: Kind; id: string }) {
  const parametro = kind === 'draft' ? `leadId=${encodeURIComponent(id)}` : `orderId=${encodeURIComponent(id)}`;
  const query = useQuery({
    queryKey: chaves.journey(id),
    queryFn: () => api<JourneyResponse>(`/events/journey?${parametro}&limit=${PASSOS_MAX}`),
  });

  if (query.isPending) return <Loading label="Carregando jornada…" />;
  if (query.error) return <ErrorState message={descreverErro(query.error)} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  if (!query.data.items.length) {
    return <Empty>Nenhum evento registrado para esta pessoa. Acontece com quem chegou antes do rastreamento estar de pé, ou com quem bloqueia scripts.</Empty>;
  }

  return (
    <>
      {query.data.items.length >= PASSOS_MAX ? (
        <p className="mb-3 text-xs text-muted">
          Esta pessoa tem mais de {PASSOS_MAX} passos registrados. Aparecem os {PASSOS_MAX} mais recentes.
        </p>
      ) : null}
      {/* A borda esquerda e o marcador fazem a leitura de cima para baixo;
          sem eles a lista parece um monte de linhas soltas, não um caminho. */}
      <ol className="m-0 grid list-none gap-2.5 border-l-2 border-line-strong p-0 pl-4">
        {query.data.items.map((p) => {
          const onde = ondeClicou(p);
          const venda = p.event === 'purchase';
          return (
            <li
              key={p.id}
              className={cn(
                'relative grid gap-0.5 text-xs text-ink-2',
                'before:absolute before:top-1.5 before:-left-[1.3125rem] before:size-2 before:rounded-full',
                venda ? 'before:bg-ok' : 'before:bg-line-strong',
              )}
            >
              <time dateTime={p.createdAt} className="text-3xs text-muted">{quando(p.createdAt)}</time>
              <span className="flex flex-wrap items-center gap-2">
                <strong className={cn('text-sm', venda ? 'text-ok' : 'text-ink')}>{rotuloDoEvento(p.event)}</strong>
                {venda ? <Badge tom="paid">Compra</Badge> : null}
              </span>
              <code className="font-mono text-3xs text-muted [overflow-wrap:anywhere]">{p.event}</code>
              {onde ? <span className="text-accent [overflow-wrap:anywhere]">{onde}</span> : null}
              {p.page ? <span className="text-3xs text-muted [overflow-wrap:anywhere]">{p.page}</span> : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

const TIPOS_ABANDONO = (drafts: number, expired: number) => [
  { value: 'draft' as const, label: `Checkout incompleto · ${drafts}` },
  { value: 'expired' as const, label: `Pix expirado · ${expired}` },
];

export function DashboardCustomers({ mode, days, drafts, expired, onClose }: { mode: 'paid' | 'abandoned'; days: number; drafts: number; expired: number; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>(mode === 'paid' ? 'paid' : drafts === 0 && expired > 0 ? 'expired' : 'draft');
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  /* Uma jornada aberta por vez: duas linhas do tempo lado a lado dentro do
     mesmo diálogo só competem por atenção. */
  const [jornada, setJornada] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['dashboard-customers', kind, days, page, search],
    queryFn: () => api<CustomerList>(`/metrics/customers?kind=${kind}&days=${days}&page=${page}&search=${encodeURIComponent(search)}`) });

  function trocarTipo(novo: 'draft' | 'expired') {
    setKind(novo);
    setPage(1);
    setJornada(null);
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:w-[min(52rem,calc(100vw-3rem))]" title={mode === 'paid' ? 'Pedidos pagos' : 'Clientes que abandonaram'}
      description={`${days === 1 ? 'Últimas 24 horas' : `Últimos ${days} dias`} · ${mode === 'paid' ? 'Pela data de pagamento' : 'Pela data de criação'}`}>
      {mode === 'abandoned' ? (
        <div className="mb-4">
          <Segmented
            value={kind === 'expired' ? 'expired' : 'draft'}
            options={TIPOS_ABANDONO(drafts, expired)}
            onChange={trocarTipo}
            label="Tipo de abandono"
            className="w-full sm:w-auto"
          />
        </div>
      ) : null}
      <form className="mb-4 flex gap-2.5" onSubmit={e => { e.preventDefault(); setSearch(term.trim()); setPage(1); setJornada(null); }}>
        <Input className="min-w-0 flex-1" aria-label="Buscar cliente por nome, e-mail ou pedido" placeholder="Nome, e-mail ou pedido" value={term} maxLength={120} onChange={e => setTerm(e.target.value)} />
        <Button type="submit" variant="ghost"><Search aria-hidden="true" />Buscar</Button>
      </form>
      {query.isPending ? <Loading label="Carregando clientes…" /> : query.error ? <ErrorState message={descreverErro(query.error)} onRetry={() => void query.refetch()} /> : query.data ? <>
        <p className="mb-3 text-sm text-muted">{query.data.total} {kind === 'draft' ? 'clientes' : 'pedidos'} encontrados</p>
        {!query.data.rows.length ? <Empty>Nenhum resultado para este período e busca.</Empty> : <div className="grid gap-3.5">
          {query.data.rows.map(row => {
            const digits = (row.phone || '').replace(/\D/g, '');
            const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
            const aberta = jornada === row.id;
            return <Surface as="article" key={row.id} className="p-4 sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <strong className="text-md [overflow-wrap:anywhere]">{row.name || 'Nome não informado'}</strong>
                <OriginBadge source={row.source} />
              </div>
              <div className="mt-3 grid gap-1 text-sm text-ink-2 [overflow-wrap:anywhere]"><span>{row.email}</span><span>{row.phone || 'Telefone não informado'}</span></div>
              <div className="my-3 flex flex-wrap justify-between gap-2 text-2xs text-muted">
                <span>{row.reference || 'Checkout sem pedido'} · {quando(row.date)}</span>
                {row.amountCents !== null ? <b className="font-bold text-ok tabular">{brl(row.amountCents)}</b> : null}
              </div>
              {mode === 'abandoned' ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {row.recoveryEmailAt
                    ? <><Badge tom="paid">Recuperação enviada</Badge><span>em {quando(row.recoveryEmailAt)}</span></>
                    : <Badge tom="neutral">Sem envio de recuperação</Badge>}
                </div>
              ) : null}
              {/* Os três atalhos usam o mesmo `Button ghost` para a linha não
                  virar três estilos diferentes de botão. */}
              <div className="mt-3.5 flex flex-wrap gap-3">
                <Button asChild variant="ghost">
                  <a href={`mailto:${encodeURIComponent(row.email)}`}><Mail aria-hidden="true" />Preparar e-mail</a>
                </Button>
                {phone.length >= 12 && phone.length <= 15 ? (
                  <Button asChild variant="ghost">
                    <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden="true" />Abrir WhatsApp</a>
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" aria-expanded={aberta} onClick={() => setJornada(atual => atual === row.id ? null : row.id)}>
                  <Route aria-hidden="true" />{aberta ? 'Esconder jornada' : 'Ver jornada'}
                  <ChevronDown aria-hidden="true" className={cn('transition-transform', aberta && 'rotate-180')} />
                </Button>
              </div>
              {aberta ? (
                <Surface tone="timeline" className="mt-3.5">
                  <Jornada kind={kind} id={row.id} />
                </Surface>
              ) : null}
            </Surface>;
          })}
        </div>}
        <Pagination
          page={page}
          total={query.data.total}
          pageSize={query.data.size}
          onChange={(p) => { setPage(p); setJornada(null); }}
          label="Páginas de clientes"
        />
      </> : null}
      <p className="mt-4 text-xs text-muted">Os atalhos abrem seu aplicativo de e-mail ou WhatsApp. Nenhuma mensagem é enviada automaticamente.</p>
    </DialogContent>
  </Dialog>;
}
