import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { brl, haQuantoTempo, num, quando } from '@/lib/format';
import type { RecoveryCheckoutRow, RecoveryPixRow, RecoveryResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Badge,
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
import { Kpi, KpiGrid, Segmented } from '@/components/ui/metrics';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { chaves, useAcao } from '../hooks';

/* ==========================================================================
   Recuperação de vendas

   Duas listas: quem preencheu o formulário e não gerou o Pix, e quem gerou e
   deixou expirar. O detalhe de cada linha abre em modal — no painel antigo
   era uma linha extra na tabela que empurrava o resto para baixo e, no
   celular, saía da tela.
   ========================================================================== */

const PERIODOS = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
];

function MarcaEmail({ recovery }: { recovery: RecoveryCheckoutRow['recovery'] }) {
  if (!recovery) return <Badge>não enviado</Badge>;
  if (recovery.status === 'enviado') return <Badge tom="paid">enviado</Badge>;
  return <Badge tom="danger">falhou</Badge>;
}

function Linha({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">{children}</div>;
}

function Dado({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <>
      <span className="text-muted">{rotulo}</span>
      <span className="min-w-0 break-words">{valor ?? '—'}</span>
    </>
  );
}

function DetalheUtm({ utm }: { utm: Record<string, string> | null }) {
  const itens = Object.entries(utm ?? {}).filter(([, v]) => v);
  if (!itens.length) return <Dado rotulo="Origem" valor="direto" />;
  return (
    <>
      {itens.map(([k, v]) => (
        <Dado key={k} rotulo={k.replace('utm_', '')} valor={v} />
      ))}
    </>
  );
}

export function TelaRecuperacao() {
  const [dias, setDias] = useState(30);
  const [aberto, setAberto] = useState<
    { tipo: 'checkout'; row: RecoveryCheckoutRow } | { tipo: 'pix'; row: RecoveryPixRow } | null
  >(null);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.recovery(dias),
    queryFn: () => api<RecoveryResponse>(`/recovery?days=${dias}`),
  });

  const rodar = useAcao(
    () => api<{ ok: true; enviados?: number }>('/recovery/run', { method: 'POST' }),
    { sucesso: 'Job de recuperação executado agora.', invalidar: [chaves.recovery(dias)] },
  );

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }

  const s = data.summary;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" loading={rodar.isPending} onClick={() => rodar.mutate(undefined)}>
          <Play />
          Rodar o job agora
        </Button>
        <Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período" />
      </div>

      <KpiGrid>
        <Kpi
          label="Checkout abandonado"
          value={num(s.checkoutAbandoned)}
          note={`${num(s.checkoutEmailed)} receberam e-mail`}
        />
        <Kpi label="Pix não pago" value={num(s.pixAbandoned)} note={`${num(s.pixEmailed)} receberam e-mail`} />
        <Kpi
          label="Recuperado"
          value={brl(s.recovered.cents)}
          note={`${num(s.recovered.count)} ${s.recovered.count === 1 ? 'venda' : 'vendas'} pelo link do e-mail`}
          tom="accent"
        />
      </KpiGrid>

      <Tabs defaultValue="checkout">
        <TabsList>
          <TabsTrigger value="checkout">Não geraram o Pix ({data.checkout.length})</TabsTrigger>
          <TabsTrigger value="pix">Geraram e não pagaram ({data.pix.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="checkout">
          <Card wide>
            <CardTitle
              title="Preencheram o formulário e pararam ali"
              hint="O rascunho é gravado quando a pessoa sai do campo de e-mail — por isso existe nome mesmo sem pedido."
            />
            {data.checkout.length === 0 ? (
              <Empty>Ninguém abandonou o checkout no período.</Empty>
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Quando</Th>
                      <Th>Pessoa</Th>
                      <Th>Origem</Th>
                      <Th>E-mail de recuperação</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.checkout.map((r) => (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => setAberto({ tipo: 'checkout', row: r })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setAberto({ tipo: 'checkout', row: r });
                        }}
                        className="cursor-pointer hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      >
                        <Td muted>{haQuantoTempo(r.lastSeenAt)}</Td>
                        <Td>
                          {r.nome}
                          <span className="block text-2xs text-muted">{r.email}</span>
                        </Td>
                        <Td muted>{r.utm?.utm_source ?? 'direto'}</Td>
                        <Td>
                          <MarcaEmail recovery={r.recovery} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="pix">
          <Card wide>
            <CardTitle
              title="Pix gerado que expirou sem pagamento"
              hint="O e-mail leva um link para gerar outro Pix, com utm_medium=recuperacao — é assim que a venda recuperada é identificada."
            />
            {data.pix.length === 0 ? (
              <Empty>Nenhum Pix expirou no período.</Empty>
            ) : (
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Quando</Th>
                      <Th>Pessoa</Th>
                      <Th num>Valor</Th>
                      <Th>E-mail de recuperação</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pix.map((r) => (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => setAberto({ tipo: 'pix', row: r })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setAberto({ tipo: 'pix', row: r });
                        }}
                        className="cursor-pointer hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      >
                        <Td muted>{haQuantoTempo(r.generatedAt)}</Td>
                        <Td>
                          {r.nome}
                          <span className="block text-2xs text-muted">{r.email}</span>
                        </Td>
                        <Td num>{brl(r.amountCents)}</Td>
                        <Td>
                          <MarcaEmail recovery={r.recovery} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={aberto !== null} onOpenChange={(v) => !v && setAberto(null)}>
        {aberto ? (
          <DialogContent
            title={aberto.row.nome}
            description={aberto.tipo === 'pix' ? `Pedido ${aberto.row.reference}` : 'Checkout abandonado'}
          >
            <div className="grid gap-5">
              <div>
                <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">Contato</h4>
                <Linha>
                  <Dado rotulo="E-mail" valor={aberto.row.email} />
                  {aberto.tipo === 'pix' ? (
                    <>
                      <Dado rotulo="Telefone" valor={aberto.row.fone} />
                      <Dado
                        rotulo="CPF"
                        valor={aberto.row.cpfLast3 ? `•••.•••.•••-${aberto.row.cpfLast3}` : '—'}
                      />
                    </>
                  ) : null}
                </Linha>
              </div>

              <div>
                <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">Quando</h4>
                <Linha>
                  {aberto.tipo === 'checkout' ? (
                    <>
                      <Dado rotulo="Começou" valor={quando(aberto.row.startedAt)} />
                      <Dado rotulo="Última atividade" valor={quando(aberto.row.lastSeenAt)} />
                    </>
                  ) : (
                    <>
                      <Dado rotulo="Pix gerado" valor={quando(aberto.row.generatedAt)} />
                      <Dado rotulo="Expirou" valor={quando(aberto.row.expiredAt)} />
                      <Dado rotulo="Valor" valor={brl(aberto.row.amountCents)} />
                    </>
                  )}
                </Linha>
              </div>

              <div>
                <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">Origem</h4>
                <Linha>
                  <DetalheUtm utm={aberto.row.utm} />
                  <Dado rotulo="Aparelho" valor={aberto.row.device} />
                  <Dado rotulo="IP" valor={aberto.row.ip} />
                </Linha>
              </div>

              <div>
                <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">
                  E-mail de recuperação
                </h4>
                {aberto.row.recovery ? (
                  <Linha>
                    <Dado rotulo="Enviado" valor={quando(aberto.row.recovery.at)} />
                    <Dado rotulo="Status" valor={aberto.row.recovery.status} />
                    {aberto.row.recovery.error ? (
                      <Dado rotulo="Erro" valor={aberto.row.recovery.error} />
                    ) : null}
                  </Linha>
                ) : (
                  <p className="text-xs text-muted">
                    Ainda não enviado. O job roda a cada minuto e respeita o prazo configurado em
                    E-mail › Automação.
                  </p>
                )}
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
