import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Server, MessageSquare, Workflow, History, KeyRound, Link2, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { api, ApiError, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { quando } from '@/lib/format';
import type { EmailCfg, EmailResponse, Template, TemplateId } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldGrid,
  Input,
  SecretInput,
  Select,
  Textarea,
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
import { useDraft, sameValue } from '../useDraft';

const VAR_HELP: Record<string, string> = {
  nome: 'Nome do destinatário', email: 'E-mail do cliente', pedido: 'Número do pedido',
  valor: 'Valor da compra', link_acesso: 'Login do produto', suporte: 'Contato de suporte',
  link_checkout: 'Retorno ao checkout', link_reset: 'Redefinir senha', minutos: 'Validade em minutos',
  convidado_por: 'Quem enviou o convite', link_convite: 'Aceitar convite', horas: 'Validade em horas',
};

/* ==========================================================================
   E-mail

   Quatro abas: provedor, templates, automação e histórico. No painel antigo
   isso era uma página só com 1.500px de rolagem no celular, e o dono tinha
   que passar por cinco templates inteiros para chegar nas regras de
   recuperação.
   ========================================================================== */

export function TelaEmail() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.email,
    queryFn: () => api<EmailResponse>('/email'),
  });

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }
  return <Conteudo dados={data} atualizar={() => void refetch()} />;
}

function Conteudo({ dados, atualizar }: { dados: EmailResponse; atualizar: () => void }) {
  const toast = useToast();
  const draft = useDraft(dados.email);
  const { value: cfg, setValue: setCfg, base } = draft;
  const [selecionado, setSelecionado] = useState<TemplateId>('purchase_approved');
  const [segredos, setSegredos] = useState<Record<string, SecretState>>({});
  const [conexao, setConexao] = useState<{ ok: boolean; detail?: string; error?: string } | null>(null);
  const [testeAberto, setTesteAberto] = useState(false);
  const [testeEmail, setTesteEmail] = useState('');
  const [testeTpl, setTesteTpl] = useState<TemplateId>('purchase_approved');

  const salvar = useAcao(
    async (parcial: Partial<EmailCfg>) => {
      const connection = 'provider' in parcial;
      const secrets = connection ? coletarSecrets(segredos) : {};
      const res = await api<{ email: EmailCfg }>('/email', {
        method: 'PUT', body: { email: parcial, secrets },
      });
      const submitted = Object.fromEntries(Object.keys(parcial).map((key) => [key, cfg[key as keyof EmailCfg]])) as Partial<EmailCfg>;
      draft.accept(submitted, res.email);
      if (connection) { setSegredos({}); setConexao(null); }
      return res;
    },
    { sucesso: 'E-mail salvo.', invalidar: [chaves.email, chaves.config] },
  );

  const testarConexao = useAcao(
    () => api<{ ok: boolean; detail?: string; error?: string }>('/email/test-connection', { method: 'POST' }),
    { onSuccess: (res) => setConexao(res) },
  );

  const enviarTeste = useAcao(
    () => api<{ ok: boolean }>('/email/send-test', { method: 'POST', body: { to: testeEmail.trim(), template: testeTpl } }),
    {
      sucesso: 'E-mail de teste enviado. Confira a caixa de entrada (e o spam).',
      invalidar: [chaves.email],
      onSuccess: () => setTesteAberto(false),
    },
  );

  const templates = Object.entries(dados.meta) as [TemplateId, { label: string; hint: string; vars: string[] }][];

  const connectionDirty = ['provider', 'fromName', 'fromEmail', 'smtp', 'accessUrl'].some(
    (key) => !sameValue(cfg[key as keyof EmailCfg], base[key as keyof EmailCfg]),
  ) || Object.keys(coletarSecrets(segredos) ?? {}).length > 0;
  const dirty = draft.dirty || connectionDirty;
  const erro = (campo: string) => salvar.error instanceof ApiError ? salvar.error.data.issues?.find((i) => i.campo === `email.${campo}`)?.erro : undefined;
  return (
    <div className="settings-workspace">
      <header className="settings-heading"><div><span className="settings-eyebrow"><Mail aria-hidden="true" /> COMUNICAÇÃO</span>
        <h2>E-mail</h2><p>Organize as mensagens que acompanham cada etapa da compra.</p></div>
        <span className={dirty ? 'settings-status is-dirty' : 'settings-status'} role="status">{dirty ? 'Alterações não salvas' : 'Configuração salva'}</span>
      </header>
    <fieldset disabled={salvar.isPending} className="settings-fieldset">
    <Tabs defaultValue="provedor">
      <TabsList className="settings-tabs">
        <TabsTrigger value="provedor"><Server aria-hidden="true" /> Conexão</TabsTrigger>
        <TabsTrigger value="templates"><MessageSquare aria-hidden="true" /> Mensagens</TabsTrigger>
        <TabsTrigger value="automacao"><Workflow aria-hidden="true" /> Automação</TabsTrigger>
        <TabsTrigger value="historico"><History aria-hidden="true" /> Histórico</TabsTrigger>
      </TabsList>

      {/* --------------------------------------------------- Provedor --- */}
      <TabsContent value="provedor">
        <div className="settings-columns">
        <aside className="settings-summary"><Server aria-hidden="true" /><h3>Resumo da conexão</h3>
          <dl><div><dt>Provedor selecionado</dt><dd>{cfg.provider === 'none' ? 'Envio desligado' : cfg.provider.toUpperCase()}</dd></div>
          <div><dt><KeyRound aria-hidden="true" /> Credencial salva</dt><dd>{dados.secrets['email.apiKey'] ? 'Cadastrada' : 'Não cadastrada'}</dd></div>
          <div><dt><Link2 aria-hidden="true" /> Link de acesso</dt><dd>{cfg.accessUrl.trim() ? 'Preenchido' : 'Não preenchido'}</dd></div></dl>
          <p>Os testes usam a configuração salva. Uma credencial cadastrada ainda precisa ser testada.</p>
          {dirty && <p className="text-accent">Salve as alterações antes de enviar um teste. A conexão usa os dados de servidor já salvos.</p>}
        </aside>
        <Card wide>
          <CardTitle
            title="Configuração de e-mail"
            hint="Defina quem envia as mensagens e como o cliente acessa o produto."
          />
          <div className="grid gap-4">
            <GroupTitle>Remetente</GroupTitle>
            <FieldGrid>
              <Field label="Nome do remetente" htmlFor="email-field-1" error={erro('fromName')}>
                <Input id="email-field-1"
                  maxLength={80}
                  value={cfg.fromName}
                  onChange={(e) => setCfg({ ...cfg, fromName: e.target.value })}
                />
              </Field>
              <Field label="E-mail do remetente" hint="Precisa ser a mesma conta autenticada no SMTP." htmlFor="email-field-2" error={erro('fromEmail')}>
                <Input id="email-field-2"
                  type="email"
                  value={cfg.fromEmail}
                  onChange={(e) => setCfg({ ...cfg, fromEmail: e.target.value })}
                />
              </Field>
            </FieldGrid>

            <GroupTitle>Servidor de envio</GroupTitle>
              <Field label="Provedor" htmlFor="email-field-3">
                <Select id="email-field-3"
                  value={cfg.provider}
                  onChange={(e) => setCfg({ ...cfg, provider: e.target.value as EmailCfg['provider'] })}
                >
                  <option value="none">Desligado — nenhum e-mail é enviado</option>
                  <option value="smtp">SMTP (Gmail com senha de app, ou qualquer servidor)</option>
                  <option value="resend" disabled>
                    Resend (em breve)
                  </option>
                </Select>
              </Field>
            {cfg.provider === 'smtp' ? (
              <div>
                <GroupTitle>SMTP</GroupTitle>
                <div className="grid gap-4">
                  <FieldGrid>
                    <Field label="Servidor" htmlFor="email-field-4" error={erro('smtp.host')}>
                      <Input id="email-field-4"
                        value={cfg.smtp.host}
                        placeholder="smtp.gmail.com"
                        onChange={(e) => setCfg({ ...cfg, smtp: { ...cfg.smtp, host: e.target.value } })}
                      />
                    </Field>
                    <Field label="Porta" hint="465 com TLS direto, 587 com STARTTLS." htmlFor="email-field-5" error={erro('smtp.port')}>
                      <Input id="email-field-5"
                        inputMode="numeric"
                        value={String(cfg.smtp.port)}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            smtp: { ...cfg.smtp, port: Number(e.target.value.replace(/\D/g, '')) || 0 },
                          })
                        }
                      />
                    </Field>
                    <Field label="Usuário" htmlFor="email-field-6">
                      <Input id="email-field-6"
                        value={cfg.smtp.user}
                        onChange={(e) => setCfg({ ...cfg, smtp: { ...cfg.smtp, user: e.target.value } })}
                      />
                    </Field>
                  </FieldGrid>
                  <ToggleRow
                    label="TLS direto (porta 465)"
                    hint="Desligue para STARTTLS na 587."
                    checked={cfg.smtp.secure}
                    onChange={(v) => setCfg({ ...cfg, smtp: { ...cfg.smtp, secure: v } })}
                  />
                  <SecretInput
                    label="Senha de app"
                    hint="No Gmail: Conta Google › Segurança › Senhas de app. Não é a senha da conta."
                    isSet={dados.secrets['email.apiKey'] === true}
                    state={segredos['email.apiKey'] ?? secretVazio}
                    onChange={(s) => setSegredos((m) => ({ ...m, 'email.apiKey': s }))}
                  />
                </div>
              </div>
            ) : null}

            <GroupTitle>Acesso ao produto</GroupTitle>
            <Field
              label="Link de acesso / login no app"
              hint="Usado no e-mail de compra aprovada e no botão Entrar no app após o pagamento. Se vazio, o botão não aparece na confirmação."
             htmlFor="email-field-7" error={erro('accessUrl')}>
              <Input id="email-field-7"
                type="url"
                inputMode="url"
                placeholder="https://area-de-membros.exemplo.com"
                value={cfg.accessUrl}
                onChange={(e) => setCfg({ ...cfg, accessUrl: e.target.value })}
              />
            </Field>

            {!cfg.accessUrl.trim() ? (
              <Callout tom="warn">
                Sem o link de acesso, quem paga recebe um e-mail apontando para a página de vendas.
                Preencha para direcionar o cliente à área do produto.
              </Callout>
            ) : null}

            {conexao ? (
              <Callout tom={conexao.ok ? 'ok' : 'err'}>
                <strong>Última verificação nesta tela: </strong>{conexao.ok
                  ? (conexao.detail ?? 'Autenticou no servidor de e-mail.')
                  : (conexao.error ?? conexao.detail ?? 'Não foi possível autenticar.')}
              </Callout>
            ) : null}

            <Actions>
              <Button
                loading={salvar.isPending}
                onClick={() =>
                  salvar.mutate({
                    provider: cfg.provider,
                    fromName: cfg.fromName.trim(),
                    fromEmail: cfg.fromEmail.trim(),
                    smtp: cfg.smtp,
                    accessUrl: cfg.accessUrl.trim(),
                  })
                }
              >
                Salvar configuração
              </Button>
              <Button variant="ghost" disabled={connectionDirty || cfg.provider === 'none'} loading={testarConexao.isPending} onClick={() => testarConexao.mutate(undefined)}>
                Testar conexão
              </Button>
              <Button variant="ghost" disabled={dirty || cfg.provider === 'none'} onClick={() => setTesteAberto(true)}>
                <Send />
                Enviar e-mail de teste
              </Button>
            </Actions>
          </div>
        </Card>
        </div>

        <Dialog open={testeAberto} onOpenChange={setTesteAberto}>
          <DialogContent
            title="Enviar e-mail de teste"
            description="Envia a mensagem salva com dados fictícios para o endereço escolhido. Esta ação envia um e-mail real."
          >
            <div className="grid gap-4">
              <Field label="Enviar para" htmlFor="email-field-8">
                <Input id="email-field-8"
                  type="email"
                  autoFocus
                  value={testeEmail}
                  onChange={(e) => setTesteEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </Field>
              <Field label="Qual template" htmlFor="email-field-9">
                <Select id="email-field-9" value={testeTpl} onChange={(e) => setTesteTpl(e.target.value as TemplateId)}>
                  {templates.map(([id, m]) => (
                    <option key={id} value={id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setTesteAberto(false)}>
                Cancelar
              </Button>
              <Button
                loading={enviarTeste.isPending}
                disabled={!testeEmail.includes('@')}
                onClick={() => enviarTeste.mutate(undefined)}
              >
                Enviar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* -------------------------------------------------- Templates --- */}
      <TabsContent value="templates">
        <div className="settings-message-layout">
        <nav className="settings-message-nav" aria-label="Tipo de mensagem"><h3>Mensagens do sistema</h3>
          {templates.map(([id, meta]) => <button type="button" key={id} aria-pressed={selecionado === id} onClick={() => setSelecionado(id)}>
            <MessageSquare aria-hidden="true" /><span>{meta.label}{!sameValue(cfg.templates[id], base.templates[id]) && <small>Alterada</small>}</span>
          </button>)}
          <p>Troque de mensagem sem perder o que está editando.</p>
        </nav>
        {templates.filter(([id]) => id === selecionado).map(([id, meta]) => (
          <Card key={id} wide>
            <CardTitle
              title={meta.label}
              hint={meta.hint}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const padrao = dados.defaults[id];
                    if (!padrao) return;
                    setCfg({ ...cfg, templates: { ...cfg.templates, [id]: padrao } });
                    toast.ok('Texto padrão restaurado no formulário. Salve para gravar.');
                  }}
                >
                  <RotateCcw />
                  Restaurar esta mensagem
                </Button>
              }
            />
            <div className="grid gap-4">
              <Field label="Assunto" htmlFor="email-field-10" error={erro(`templates.${id}.subject`)}>
                <Input id="email-field-10"
                  maxLength={160}
                  value={cfg.templates[id]?.subject ?? ''}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      templates: {
                        ...cfg.templates,
                        [id]: { ...(cfg.templates[id] as Template), subject: e.target.value },
                      },
                    })
                  }
                />
              </Field>
              <Field label="Corpo do e-mail" htmlFor="email-field-11" error={erro(`templates.${id}.body`)}>
                <Textarea id="email-field-11"
                  value={cfg.templates[id]?.body ?? ''}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      templates: {
                        ...cfg.templates,
                        [id]: { ...(cfg.templates[id] as Template), body: e.target.value },
                      },
                    })
                  }
                />
              </Field>
              <details className="settings-advanced"><summary>Personalização automática da mensagem</summary>
              <p className="text-sm text-muted">Copie a variável para o texto. No envio, ela será substituída pelo dado correspondente.</p>
              <div className="settings-variables">
                {meta.vars.map((v) => (
                  <code
                    key={v}
                    title={VAR_HELP[v] ?? v}
                  >
                    {`{{${v}}}`} — {VAR_HELP[v] ?? v}
                  </code>
                ))}
              </div></details>
            </div>
            <p className="mt-5 text-sm text-muted">Salva todas as mensagens alteradas neste formulário.</p>
            <Actions>
              <Button loading={salvar.isPending} onClick={() => salvar.mutate({ templates: cfg.templates })}>
                Salvar mensagens
              </Button>
            </Actions>
          </Card>
        ))}
        </div>
      </TabsContent>

      {/* -------------------------------------------------- Automação --- */}
      <TabsContent value="automacao">
        <Card wide>
          <CardTitle
            title="Recuperação automática"
            hint="Defina quando lembrar o cliente de concluir a compra. Cada regra mantém o controle de um envio por abandono."
          />
          <div className="settings-automation-grid">
            <section className="settings-rule"><Workflow aria-hidden="true" /><h3>Checkout não concluído</h3><p>Para quem preencheu os dados e não gerou o Pix.</p>
            <ToggleRow
              label="Avisar quem preencheu o formulário e não gerou o Pix"
              checked={cfg.recovery.checkoutAbandonedEnabled}
              onChange={(v) => setCfg({ ...cfg, recovery: { ...cfg.recovery, checkoutAbandonedEnabled: v } })}
            />
            {cfg.recovery.checkoutAbandonedEnabled ? (
              <FieldGrid>
                <Field label="Esperar quantos minutos" hint="Entre 5 e 1440." htmlFor="email-field-12" error={erro('recovery.checkoutAbandonedAfterMin')}>
                  <Input id="email-field-12"
                    inputMode="numeric"
                    value={String(cfg.recovery.checkoutAbandonedAfterMin)}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        recovery: {
                          ...cfg.recovery,
                          checkoutAbandonedAfterMin: Number(e.target.value.replace(/\D/g, '')) || 0,
                        },
                      })
                    }
                  />
                </Field>
              </FieldGrid>
            ) : null}

            <p className="settings-rule-summary">{cfg.recovery.checkoutAbandonedEnabled ? `Enviar após ${cfg.recovery.checkoutAbandonedAfterMin} minutos sem concluir.` : 'Automação desativada.'}</p>
            </section>
            <section className="settings-rule"><History aria-hidden="true" /><h3>Pix expirado</h3><p>Para quem gerou o código e deixou o prazo terminar.</p>
            <ToggleRow
              label="Avisar quem gerou o Pix e deixou expirar"
              checked={cfg.recovery.pixAbandonedEnabled}
              onChange={(v) => setCfg({ ...cfg, recovery: { ...cfg.recovery, pixAbandonedEnabled: v } })}
            />
            {cfg.recovery.pixAbandonedEnabled ? (
              <FieldGrid>
                <Field label="Esperar quantos minutos depois de expirar" hint="Entre 1 e 1440." htmlFor="email-field-13" error={erro('recovery.pixAbandonedAfterMin')}>
                  <Input id="email-field-13"
                    inputMode="numeric"
                    value={String(cfg.recovery.pixAbandonedAfterMin)}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        recovery: {
                          ...cfg.recovery,
                          pixAbandonedAfterMin: Number(e.target.value.replace(/\D/g, '')) || 0,
                        },
                      })
                    }
                  />
                </Field>
              </FieldGrid>
            ) : null}
            <p className="settings-rule-summary">{cfg.recovery.pixAbandonedEnabled ? `Enviar após ${cfg.recovery.pixAbandonedAfterMin} minutos da expiração.` : 'Automação desativada.'}</p>
            </section>
          </div>
          <Actions>
            <Button loading={salvar.isPending} onClick={() => salvar.mutate({ recovery: cfg.recovery })}>
              Salvar automação
            </Button>
          </Actions>
        </Card>
      </TabsContent>

      {/* -------------------------------------------------- Histórico --- */}
      <TabsContent value="historico">
        <Card wide>
          <CardTitle title="Últimos 20 envios" hint="Tentativas mais recentes de envio e retorno do provedor." action={<Button variant="ghost" onClick={atualizar}><RefreshCw /> Atualizar</Button>} />
          {dados.recent.length === 0 ? (
            <Empty>Nenhum e-mail enviado ainda.</Empty>
          ) : (
            <div className="settings-history-table"><TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Quando</Th>
                    <Th>Para</Th>
                    <Th>Template</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {dados.recent.map((log) => (
                    <tr key={log.id}>
                      <Td muted>{quando(log.sentAt ?? log.createdAt)}</Td>
                      <Td>{log.to}</Td>
                      <Td muted>{dados.meta[log.template]?.label ?? log.template}</Td>
                      <Td>
                        {log.status === 'enviado' ? (
                          <Badge tom="paid">enviado</Badge>
                        ) : (
                          <span className="flex flex-col gap-1">
                            <Badge tom="danger">falhou</Badge>
                            {log.error ? (
                              <details className="settings-error"><summary>Ver erro</summary><p>{log.error}</p></details>
                            ) : null}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap></div>
          )}
          <div className="settings-history-mobile">{dados.recent.map((log) => <article key={log.id}>
            <div><Badge tom={log.status === 'enviado' ? 'paid' : 'danger'}>{log.status === 'enviado' ? 'Enviado' : 'Falhou'}</Badge><time>{quando(log.sentAt ?? log.createdAt)}</time></div>
            <strong>{log.to}</strong><p>{dados.meta[log.template]?.label ?? log.template}</p>
            {log.error && <details className="settings-error"><summary>Ver erro</summary><p>{log.error}</p></details>}
          </article>)}</div>
        </Card>
      </TabsContent>
    </Tabs>
    </fieldset>
    </div>
  );
}
