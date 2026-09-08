import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { num, pct, quando } from '@/lib/format';
import type { EventsList, EventsSummary } from '@/lib/types';
import { Segmented } from '@/components/ui/metrics';
import {
  Card,
  CardTitle,
  Empty,
  ErrorState,
  Loading,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { chaves } from '../hooks';

const PERIODOS = [
  { value: 1, label: '24 h' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

export function TelaEventos() {
  const [dias, setDias] = useState(7);

  const resumo = useQuery({
    queryKey: chaves.eventsSummary(dias),
    queryFn: () => api<EventsSummary>(`/events/summary?days=${dias}`),
  });

  const lista = useQuery({
    queryKey: chaves.events(dias, null),
    queryFn: () => api<EventsList>(`/events?days=${dias}&limit=40`),
  });

  if (resumo.isPending) return <Loading />;
  if (resumo.error) {
    if (ehSessaoExpirada(resumo.error)) return null;
    return <ErrorState message={descreverErro(resumo.error)} onRetry={() => void resumo.refetch()} />;
  }

  const s = resumo.data;

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período" />
      </div>

      <Card wide>
        <CardTitle
          title="Funil"
          hint="Sessões conta pessoas distintas; eventos conta disparos. A porcentagem é sobre as visitas do período — uma pessoa que recarrega a página cinco vezes é uma visita, não cinco."
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Etapa</Th>
                <Th num>Sessões</Th>
                <Th num>Eventos</Th>
                <Th num>% das visitas</Th>
              </tr>
            </thead>
            <tbody>
              {s.funnel.map((step) => (
                <tr key={step.event}>
                  <Td>{step.label}</Td>
                  <Td num>{num(step.uniques)}</Td>
                  <Td num muted>
                    {num(step.total)}
                  </Td>
                  <Td num>{pct(step.rate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Card wide>
        <CardTitle title="Origem do tráfego" hint="Sessões distintas que abriram a página, por utm_source." />
        {s.sources.length === 0 ? (
          <Empty>Nenhuma visita registrada no período.</Empty>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Origem</Th>
                  <Th num>Sessões</Th>
                </tr>
              </thead>
              <tbody>
                {s.sources.map((src) => (
                  <tr key={src.source}>
                    <Td>{src.source}</Td>
                    <Td num>{num(src.sessions)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card wide>
        <CardTitle
          title="Últimos eventos"
          hint="Útil para conferir se o rastreamento está chegando enquanto você mexe no GTM. A sessão aparece cortada de propósito: é tela de depuração, não de identificar visitante."
        />
        {lista.isPending ? (
          <Loading label="Buscando os últimos disparos…" />
        ) : lista.error ? (
          <ErrorState message={descreverErro(lista.error)} onRetry={() => void lista.refetch()} />
        ) : lista.data.items.length === 0 ? (
          <Empty>Nenhum evento ainda. Abra a landing page para gerar o primeiro.</Empty>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Evento</Th>
                  <Th>Página</Th>
                  <Th>Origem</Th>
                  <Th>Sessão</Th>
                </tr>
              </thead>
              <tbody>
                {lista.data.items.map((i) => (
                  <tr key={i.id}>
                    <Td muted>{quando(i.createdAt)}</Td>
                    <Td>
                      <code className="text-xs">{i.event}</code>
                    </Td>
                    <Td muted>{i.page ?? '—'}</Td>
                    <Td>{i.utm?.utm_source ?? (i.referrer ? 'referência' : 'direto')}</Td>
                    <Td muted>{i.sessionId ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
