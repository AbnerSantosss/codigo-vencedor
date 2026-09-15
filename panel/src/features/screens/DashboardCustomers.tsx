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
import { Empty, ErrorState, Loading } from '@/components/ui/layout';
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
    <ol className="journey">
      {query.data.items.map((p) => {
        const onde = ondeClicou(p);
        return (
          <li key={p.id} className={cn('journey-step', p.event === 'purchase' && 'journey-step-win')}>
            <time dateTime={p.createdAt}>{quando(p.createdAt)}</time>
            <strong>{rotuloDoEvento(p.event)}</strong>
            <code>{p.event}</code>
            {onde ? <span className="journey-where">{onde}</span> : null}
            {p.page ? <span className="journey-page">{p.page}</span> : null}
          </li>
        );
      })}
    </ol>
    </>
  );
}

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
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dashboard-customer-dialog" title={mode === 'paid' ? 'Pedidos pagos' : 'Clientes que abandonaram'}
      description={`${days === 1 ? 'Últimas 24 horas' : `Últimos ${days} dias`} · ${mode === 'paid' ? 'Pela data de pagamento' : 'Pela data de criação'}`}>
      {mode === 'abandoned' ? <div className="customer-tabs" role="group" aria-label="Tipo de abandono">
        <Button aria-pressed={kind === 'draft'} variant={kind === 'draft' ? 'primary' : 'ghost'} onClick={() => { setKind('draft'); setPage(1); setJornada(null); }}>Checkout incompleto · {drafts}</Button>
        <Button aria-pressed={kind === 'expired'} variant={kind === 'expired' ? 'primary' : 'ghost'} onClick={() => { setKind('expired'); setPage(1); setJornada(null); }}>Pix expirado · {expired}</Button>
      </div> : null}
      <form className="customer-search" onSubmit={e => { e.preventDefault(); setSearch(term.trim()); setPage(1); setJornada(null); }}>
        <Input aria-label="Buscar cliente por nome, e-mail ou pedido" placeholder="Nome, e-mail ou pedido" value={term} maxLength={120} onChange={e => setTerm(e.target.value)} />
        <Button type="submit" variant="ghost"><Search aria-hidden="true" />Buscar</Button>
      </form>
      {query.isPending ? <Loading label="Carregando clientes…" /> : query.error ? <ErrorState message={descreverErro(query.error)} onRetry={() => void query.refetch()} /> : query.data ? <>
        <p className="mb-3 text-sm text-muted">{query.data.total} {kind === 'draft' ? 'clientes' : 'pedidos'} encontrados</p>
        {!query.data.rows.length ? <Empty>Nenhum resultado para este período e busca.</Empty> : <div className="customer-list">
          {query.data.rows.map(row => {
            const digits = (row.phone || '').replace(/\D/g, '');
            const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
            return <article key={row.id} className="customer-item">
              <div className="customer-item-head"><strong>{row.name || 'Nome não informado'}</strong><OriginBadge source={row.source} /></div>
              <div className="customer-item-info"><span>{row.email}</span><span>{row.phone || 'Telefone não informado'}</span></div>
              <div className="customer-item-meta"><span>{row.reference || 'Checkout sem pedido'} · {quando(row.date)}</span>{row.amountCents !== null ? <b>{brl(row.amountCents)}</b> : null}</div>
              {mode === 'abandoned' ? <p className="text-xs text-muted">{row.recoveryEmailAt ? `Recuperação registrada em ${quando(row.recoveryEmailAt)}` : 'Sem envio de recuperação registrado'}</p> : null}
              <div className="customer-actions">
                <a href={`mailto:${encodeURIComponent(row.email)}`}><Mail aria-hidden="true" />Preparar e-mail</a>
                {phone.length >= 12 && phone.length <= 15 ? <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden="true" />Abrir WhatsApp</a> : null}
                <button type="button" className="journey-toggle" aria-expanded={jornada === row.id} onClick={() => setJornada(atual => atual === row.id ? null : row.id)}>
                  <Route aria-hidden="true" />{jornada === row.id ? 'Esconder jornada' : 'Ver jornada'}
                  <ChevronDown aria-hidden="true" className={cn('journey-caret', jornada === row.id && 'journey-caret-open')} />
                </button>
              </div>
              {jornada === row.id ? <div className="journey-wrap"><Jornada kind={kind} id={row.id} /></div> : null}
            </article>;
          })}
        </div>}
        <div className="customer-pagination"><Button variant="ghost" disabled={page === 1} onClick={() => { setPage(p => p - 1); setJornada(null); }}>Anterior</Button><span>Página {page} de {Math.max(1, Math.ceil(query.data.total / query.data.size))}</span><Button variant="ghost" disabled={page * query.data.size >= query.data.total} onClick={() => { setPage(p => p + 1); setJornada(null); }}>Próxima</Button></div>
      </> : null}
      <p className="mt-4 text-xs text-muted">Os atalhos abrem seu aplicativo de e-mail ou WhatsApp. Nenhuma mensagem é enviada automaticamente.</p>
    </DialogContent>
  </Dialog>;
}
