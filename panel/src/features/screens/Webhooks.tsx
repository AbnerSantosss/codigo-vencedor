import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, PlugZap, Plus, RotateCw, Send, Trash2 } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { quando } from '@/lib/format';
import type {
  DeliveryRow,
  InboundRow,
  MetodoWebhook,
  OutboundWebhook,
  TesteWebhookResponse,
  WebhooksResponse,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, Input, Select, Textarea, ToggleRow } from '@/components/ui/form';
import {
  Badge,
  Callout,
  Card,
  CardTitle,
  Empty,
  ErrorState,
  GroupTitle,
  Loading,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { chaves, useAcao } from '../hooks';

/* ==========================================================================
   Integrações e webhooks

   O backend disto foi construído e ficou sem tela: as rotas de
   `src/routes/admin/webhooks.ts` e o serviço `src/services/outbound.ts`
   existem desde a FASE 4, e até agora só respondiam a curl. Esta é a tela.

   Duas regras que a tela precisa respeitar, e por isso estão escritas aqui:

   1. **O segredo aparece uma vez.** Ele é mostrado na criação e na rotação e
      nunca mais volta por nenhuma rota — guardar de forma reversível para
      poder reexibir é como um segredo vaza junto com o banco. Quem perdeu,
      rotaciona.
   2. **HTTP é aviso, não impedimento.** URL sem TLS entrega o corpo do
      evento em texto claro no caminho; a tela marca, o servidor deixa (pode
      ser um n8n na rede interna).
   ========================================================================== */

function estadoDaEntrega(d: DeliveryRow) {
  if (d.deliveredAt) return { label: `entregue · ${d.statusCode ?? 200}`, tom: 'paid' as const };
  if (d.morta) return { label: `desistiu · ${d.statusCode ?? 'sem resposta'}`, tom: 'danger' as const };
  return { label: `tentando · ${d.statusCode ?? 'sem resposta'}`, tom: 'pending' as const };
}

export function TelaWebhooks() {
  const toast = useToast();
  const [form, setForm] = useState<null | { modo: 'novo' } | { modo: 'editar'; w: OutboundWebhook }>(null);
  const [excluir, setExcluir] = useState<OutboundWebhook | null>(null);
  const [segredoNovo, setSegredoNovo] = useState<{ nome: string; secret: string } | null>(null);
  const [historico, setHistorico] = useState<OutboundWebhook | null>(null);

  const lista = useQuery({
    queryKey: chaves.webhooks,
    queryFn: () => api<WebhooksResponse>('/webhooks'),
  });

  const inbound = useQuery({
    queryKey: chaves.inbound,
    queryFn: () => api<{ inbound: InboundRow[] }>('/webhooks/inbound?limit=30'),
  });

  const testar = useAcao(
    (id: string) => api<TesteWebhookResponse>(`/webhooks/${id}/test`, { method: 'POST' }),
    {
      invalidar: [chaves.webhooks],
      sucesso: (r) =>
        r.ok
          ? `O destino respondeu ${r.statusCode ?? 200}. Integração funcionando.`
          : `O destino respondeu ${r.statusCode ?? 'nada'}. Veja o histórico para o corpo da resposta.`,
    },
  );

  const rotacionar = useAcao(
    (w: OutboundWebhook) =>
      api<{ secret: string; aviso: string }>(`/webhooks/${w.id}/rotate-secret`, { method: 'POST' }).then((r) => ({
        ...r,
        nome: w.name,
      })),
    {
      invalidar: [chaves.webhooks],
      onSuccess: (r) => setSegredoNovo({ nome: r.nome, secret: r.secret }),
    },
  );

  const remover = useAcao((id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }), {
    sucesso: 'Integração removida.',
    invalidar: [chaves.webhooks],
    onSuccess: () => setExcluir(null),
  });

  if (lista.isPending) return <Loading />;
  if (lista.error) {
    if (ehSessaoExpirada(lista.error)) return null;
    return <ErrorState message={descreverErro(lista.error)} onRetry={() => void lista.refetch()} />;
  }

  const eventos = lista.data.eventos;

  return (
    <Tabs defaultValue="saida">
      <TabsList>
        <TabsTrigger value="saida">Avisar outro sistema ({lista.data.webhooks.length})</TabsTrigger>
        <TabsTrigger value="entrada">O que os gateways nos avisaram</TabsTrigger>
      </TabsList>

      {/* --------------------------------------------------- Saída --- */}
      <TabsContent value="saida">
        <Card wide>
          <CardTitle
            title="Webhooks de saída"
            hint="A cada evento, o servidor faz uma requisição assinada para a URL que você cadastrar — serve para n8n, Make, planilha, área de membros ou o que precisar liberar acesso."
            action={
              <Button onClick={() => setForm({ modo: 'novo' })}>
                <Plus />
                Nova integração
              </Button>
            }
          />

          {lista.data.webhooks.length === 0 ? (
            <Empty>
              Nenhuma integração cadastrada. O pagamento confirmado continua liberando e-mail e
              conversões — isto aqui é para avisar sistemas de fora.
            </Empty>
          ) : (
            <div className="grid gap-3">
              {lista.data.webhooks.map((w) => (
                <div key={w.id} className="rounded-md border border-line bg-bg p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-md">{w.name}</strong>
                        {w.active ? <Badge tom="paid">ativo</Badge> : <Badge>pausado</Badge>}
                        {w.avisoHttp ? <Badge tom="pending">sem HTTPS</Badge> : null}
                        {w.cartasMortas > 0 ? (
                          <Badge tom="danger">{w.cartasMortas} desistiu</Badge>
                        ) : null}
                      </div>
                      <code className="mt-1 block text-2xs break-all text-muted">
                        {w.method} {w.url}
                      </code>
                      <p className="mt-1.5 text-2xs text-muted">
                        {w.events.map((e) => eventos[e] ?? e).join(' · ')}
                      </p>
                      <p className="mt-1 text-2xs text-muted">
                        {w.entregas} {w.entregas === 1 ? 'entrega' : 'entregas'}
                        {w.ultimaEntregaAt ? ` · última ${quando(w.ultimaEntregaAt)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setForm({ modo: 'editar', w })}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={testar.isPending && testar.variables === w.id}
                      onClick={() => testar.mutate(w.id)}
                    >
                      <Send />
                      Testar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setHistorico(w)}>
                      Histórico
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={rotacionar.isPending && rotacionar.variables?.id === w.id}
                      onClick={() => rotacionar.mutate(w)}
                    >
                      <RotateCw />
                      Novo segredo
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setExcluir(w)}>
                      <Trash2 />
                      Excluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle
            title="Como o destino confere que é você"
            hint="O que o servidor manda em cada requisição, para o outro lado poder validar."
          />
          <ul className="grid gap-2 text-sm text-ink-2">
            <li>
              <code>X-CV-Event</code> — o nome do evento (<code>order.paid</code>, por exemplo).
            </li>
            <li>
              <code>X-CV-Signature</code> — HMAC-SHA256 do corpo, com o segredo desta integração.
              Compare em tempo constante do outro lado.
            </li>
            <li>
              <code>X-CV-Delivery</code> — o id da entrega. Repetido significa retentativa da{' '}
              <strong>mesma</strong> entrega: trate como idempotente.
            </li>
            <li>
              Falha 5xx ou timeout é retentada com espera crescente, até {lista.data.maxTentativas}{' '}
              tentativas. Depois disso a entrega fica marcada como "desistiu" e pode ser reprocessada
              à mão no histórico.
            </li>
          </ul>
        </Card>
      </TabsContent>

      {/* -------------------------------------------------- Entrada --- */}
      <TabsContent value="entrada">
        <Card wide>
          <CardTitle
            title="Notificações recebidas dos gateways"
            hint="Toda notificação passa por assinatura antes de ser aceita, e o status do pagamento é sempre reconsultado na API do provedor — nunca lido do corpo da notificação."
          />
          {inbound.isPending ? (
            <Loading />
          ) : inbound.error ? (
            <ErrorState message={descreverErro(inbound.error)} onRetry={() => void inbound.refetch()} />
          ) : inbound.data.inbound.length === 0 ? (
            <Empty>
              Nenhuma notificação recebida ainda. Ela chega quando o gateway estiver configurado e
              apontando o webhook para <code>/webhooks/mercadopago</code>.
            </Empty>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Quando</Th>
                    <Th>Provedor</Th>
                    <Th>Tipo</Th>
                    <Th>Pedido</Th>
                    <Th>Processada</Th>
                  </tr>
                </thead>
                <tbody>
                  {inbound.data.inbound.map((e) => (
                    <tr key={e.id}>
                      <Td muted>{quando(e.receivedAt)}</Td>
                      <Td>{e.provider}</Td>
                      <Td muted>{e.eventType ?? '—'}</Td>
                      <Td>{e.reference ?? '—'}</Td>
                      <Td>
                        {e.processedAt ? (
                          <Badge tom="paid">{e.result ?? 'ok'}</Badge>
                        ) : (
                          <Badge tom="pending">pendente</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </TabsContent>

      {/* ------------------------------------------------ Formulário --- */}
      {form ? (
        <FormularioWebhook
          eventos={eventos}
          inicial={form.modo === 'editar' ? form.w : null}
          onFechar={() => setForm(null)}
          onSegredo={(nome, secret) => setSegredoNovo({ nome, secret })}
        />
      ) : null}

      {/* --------------------------------------------------- Segredo --- */}
      <Dialog open={segredoNovo !== null} onOpenChange={(v) => !v && setSegredoNovo(null)}>
        {segredoNovo ? (
          <DialogContent
            title="Guarde este segredo agora"
            description="Ele não será exibido de novo. Se perder, gere outro — e reconfigure o destino."
          >
            <Callout tom="warn">
              Cole isto na configuração de <strong>{segredoNovo.nome}</strong> do outro lado. É com ele
              que o destino valida o <code>X-CV-Signature</code> de cada entrega.
            </Callout>
            <div className="flex items-center gap-2">
              <Input readOnly value={segredoNovo.secret} className="font-mono text-xs" />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copiar"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(segredoNovo.secret)
                    .then(() => toast.ok('Segredo copiado.'))
                    .catch(() => toast.erro('Não foi possível copiar — selecione e copie à mão.'));
                }}
              >
                <Copy />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setSegredoNovo(null)}>Já guardei</Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* --------------------------------------------------- Excluir --- */}
      <Dialog open={excluir !== null} onOpenChange={(v) => !v && setExcluir(null)}>
        {excluir ? (
          <DialogContent
            title="Excluir esta integração?"
            description="O histórico de entregas dela vai junto. Se a ideia é só parar de enviar por um tempo, edite e desligue em vez de excluir."
          >
            <p className="text-sm text-ink-2">
              <strong>{excluir.name}</strong> para de receber eventos imediatamente.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setExcluir(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={remover.isPending} onClick={() => remover.mutate(excluir.id)}>
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* ------------------------------------------------- Histórico --- */}
      <Dialog open={historico !== null} onOpenChange={(v) => !v && setHistorico(null)}>
        {historico ? <HistoricoEntregas webhook={historico} eventos={eventos} /> : null}
      </Dialog>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ *
 * Formulário
 * ------------------------------------------------------------------ */

function FormularioWebhook({
  eventos,
  inicial,
  onFechar,
  onSegredo,
}: {
  eventos: Record<string, string>;
  inicial: OutboundWebhook | null;
  onFechar: () => void;
  onSegredo: (nome: string, secret: string) => void;
}) {
  const [nome, setNome] = useState(inicial?.name ?? '');
  const [url, setUrl] = useState(inicial?.url ?? '');
  const [metodo, setMetodo] = useState<MetodoWebhook>(inicial?.method ?? 'POST');
  const [ativos, setAtivos] = useState<string[]>(inicial?.events ?? ['order.paid']);
  const [ativo, setAtivo] = useState(inicial?.active ?? true);
  const [headers, setHeaders] = useState(
    inicial?.headers ? JSON.stringify(inicial.headers, null, 2) : '',
  );
  const [erroHeaders, setErroHeaders] = useState<string | null>(null);

  const salvar = useAcao(
    (corpo: Record<string, unknown>): Promise<{ webhook: OutboundWebhook; secret?: string }> =>
      inicial
        ? api<{ webhook: OutboundWebhook }>(`/webhooks/${inicial.id}`, { method: 'PUT', body: corpo })
        : api<{ webhook: OutboundWebhook; secret: string }>('/webhooks', { method: 'POST', body: corpo }),
    {
      invalidar: [chaves.webhooks],
      sucesso: inicial ? 'Integração atualizada.' : undefined,
      onSuccess: (res) => {
        // O segredo só existe na resposta da criação — é a única vez que ele
        // sai do servidor.
        if (res.secret) onSegredo(res.webhook.name, res.secret);
        onFechar();
      },
    },
  );

  function submeter() {
    let headersObj: Record<string, string> | undefined;
    if (headers.trim()) {
      try {
        const lido = JSON.parse(headers) as unknown;
        if (typeof lido !== 'object' || lido === null || Array.isArray(lido)) {
          throw new Error('precisa ser um objeto');
        }
        headersObj = lido as Record<string, string>;
      } catch (err) {
        setErroHeaders(`JSON inválido: ${err instanceof Error ? err.message : 'confira as chaves e vírgulas'}`);
        return;
      }
    }
    setErroHeaders(null);
    salvar.mutate({
      name: nome.trim(),
      url: url.trim(),
      method: metodo,
      events: ativos,
      headers: headersObj,
      active: ativo,
    });
  }

  const semHttps = url.trim().startsWith('http://');

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent
        title={inicial ? `Editar ${inicial.name}` : 'Nova integração'}
        description="O servidor vai fazer esta requisição a cada evento marcado, assinada com o segredo desta integração."
      >
        <div className="grid gap-4">
          <FieldGrid>
            <Field label="Nome" hint="Só para você reconhecer na lista.">
              <Input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Método">
              <Select value={metodo} onChange={(e) => setMetodo(e.target.value as MetodoWebhook)}>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </Select>
            </Field>
          </FieldGrid>

          <Field
            label="URL de destino"
            hint="Não coloque usuário e senha na URL — use o campo de headers."
            htmlFor="wh-url"
          >
            <Input
              id="wh-url"
              type="url"
              inputMode="url"
              placeholder="https://n8n.exemplo.com/webhook/codigo-vencedor"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>

          {semHttps ? (
            <Callout tom="warn">
              Sem HTTPS o corpo do evento — que inclui nome e e-mail do comprador — viaja em texto
              claro. Só use assim numa rede interna.
            </Callout>
          ) : null}

          <div>
            <GroupTitle>Quando disparar</GroupTitle>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {Object.entries(eventos).map(([id, rotulo]) => (
                <ToggleRow
                  key={id}
                  label={rotulo}
                  hint={id}
                  checked={ativos.includes(id)}
                  onChange={(v) =>
                    setAtivos((atual) => (v ? [...new Set([...atual, id])] : atual.filter((x) => x !== id)))
                  }
                />
              ))}
            </div>
            {ativos.length === 0 ? (
              <p className="mt-2 text-2xs text-danger">Escolha ao menos um evento.</p>
            ) : null}
          </div>

          <Field
            label="Headers extras (JSON)"
            hint='Opcional. Ex.: {"Authorization": "Bearer …"} — no máximo 15 headers.'
            error={erroHeaders}
          >
            <Textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={'{\n  "Authorization": "Bearer …"\n}'}
              className="min-h-28"
            />
          </Field>

          <ToggleRow
            label="Integração ativa"
            hint="Desligada, ela para de receber eventos sem perder o cadastro nem o histórico."
            checked={ativo}
            onChange={setAtivo}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            loading={salvar.isPending}
            disabled={nome.trim().length < 2 || url.trim().length < 8 || ativos.length === 0}
            onClick={submeter}
          >
            {inicial ? 'Salvar' : 'Criar e mostrar o segredo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Histórico de entregas
 * ------------------------------------------------------------------ */

function HistoricoEntregas({
  webhook,
  eventos,
}: {
  webhook: OutboundWebhook;
  eventos: Record<string, string>;
}) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.deliveries(webhook.id),
    queryFn: () => api<{ deliveries: DeliveryRow[] }>(`/webhooks/${webhook.id}/deliveries?limit=30`),
  });

  const reprocessar = useAcao(
    (id: string) =>
      api<{ ok: boolean; statusCode: number | null }>(`/webhooks/deliveries/${id}/retry`, { method: 'POST' }),
    {
      invalidar: [chaves.deliveries(webhook.id), chaves.webhooks],
      sucesso: (r) => (r.ok ? 'Entregue agora.' : `O destino respondeu ${r.statusCode ?? 'nada'} de novo.`),
    },
  );

  return (
    <DialogContent title={`Entregas de ${webhook.name}`} description="As 30 mais recentes.">
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />
      ) : data.deliveries.length === 0 ? (
        <Empty>
          Nenhuma entrega ainda. Use "testar" na lista para mandar um evento de exemplo e conferir a
          integração.
        </Empty>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Evento</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.deliveries.map((d) => {
                const est = estadoDaEntrega(d);
                return (
                  <tr key={d.id}>
                    <Td muted>{quando(d.createdAt)}</Td>
                    <Td>
                      {eventos[d.event] ?? d.event}
                      {d.reference ? <span className="block text-2xs text-muted">{d.reference}</span> : null}
                    </Td>
                    <Td>
                      <Badge tom={est.tom}>{est.label}</Badge>
                      <span className="block text-2xs text-muted">
                        tentativa {d.attempt}
                        {d.nextRetryAt ? ` · próxima ${quando(d.nextRetryAt)}` : ''}
                      </span>
                    </Td>
                    <Td>
                      {!d.deliveredAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={reprocessar.isPending && reprocessar.variables === d.id}
                          onClick={() => reprocessar.mutate(d.id)}
                        >
                          <PlugZap />
                          Reenviar
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}

      <p className="mt-4 flex items-start gap-2 text-2xs text-muted">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Reenviar usa o mesmo <code>X-CV-Delivery</code> da tentativa original — do outro lado, isso
        precisa ser tratado como idempotente.
      </p>
    </DialogContent>
  );
}
