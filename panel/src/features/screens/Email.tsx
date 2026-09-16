import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Server, MessageSquare, Workflow, History, KeyRound, Link2, RefreshCw, RotateCcw, Send, ChevronDown } from 'lucide-react';
import { api, ApiError, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { cn } from '@/lib/cn';
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
import { Badge, Callout, Empty, ErrorState, GroupTitle, Loading } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { SaveBar } from '@/components/ui/save-bar';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/ui/table';
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

const TAB = 'inline-flex items-center gap-2 [&_svg]:size-4';

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

/** Linha "rótulo → valor" do resumo da conexão. */
function Resumo({ icone, rotulo, valor }: { icone?: React.ReactNode; rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-2xs text-muted [&_svg]:size-3.5">
        {icone}
        {rotulo}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold break-words">{valor}</dd>
    </div>
  );
}

/** Erro de envio, escondido atrás de um "ver erro" para não alargar a lista. */
function ErroEnvio({ texto }: { texto: string }) {
  return (
    <details className="max-w-[26rem] text-2xs text-muted">
      <summary className="cursor-pointer py-1 font-semibold">Ver erro</summary>
      <p className="whitespace-normal break-words">{texto}</p>
    </details>
  );
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
  const templatesDirty = !sameValue(cfg.templates, base.templates);
  const recoveryDirty = !sameValue(cfg.recovery, base.recovery);
  const dirty = draft.dirty || connectionDirty;
  const erro = (campo: string) => salvar.error instanceof ApiError ? salvar.error.data.issues?.find((i) => i.campo === `email.${campo}`)?.erro : undefined;

  return (
    <div className="min-w-0">
      <SurfaceHeader
        eyebrow="Comunicação"
        icon={<Mail />}
        title="E-mail"
        hint="Organize as mensagens que acompanham cada etapa da compra."
        action={dirty ? <Badge tom="pending">alterações não salvas</Badge> : <Badge tom="paid">configuração salva</Badge>}
      />
    <fieldset disabled={salvar.isPending} className="min-w-0">
    <Tabs defaultValue="provedor">
      <TabsList variant="segment">
        <TabsTrigger value="provedor" className={TAB}><Server aria-hidden="true" /> Conexão</TabsTrigger>
        <TabsTrigger value="templates" className={TAB}><MessageSquare aria-hidden="true" /> Mensagens</TabsTrigger>
        <TabsTrigger value="automacao" className={TAB}><Workflow aria-hidden="true" /> Automação</TabsTrigger>
        <TabsTrigger value="historico" className={TAB}><History aria-hidden="true" /> Histórico</TabsTrigger>
      </TabsList>

      {/* --------------------------------------------------- Provedor --- */}
      <TabsContent value="provedor">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Surface as="section" tone="elevated" className="lg:col-start-2 lg:row-start-1" aria-label="Resumo">
          <SurfaceHeader icon={<Server />} title="Resumo da conexão" />
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <Resumo rotulo="Provedor selecionado" valor={cfg.provider === 'none' ? 'Envio desligado' : cfg.provider.toUpperCase()} />
            <Resumo icone={<KeyRound aria-hidden="true" />} rotulo="Credencial salva" valor={dados.secrets['email.apiKey'] ? 'Cadastrada' : 'Não cadastrada'} />
            <Resumo icone={<Link2 aria-hidden="true" />} rotulo="Link de acesso" valor={cfg.accessUrl.trim() ? 'Preenchido' : 'Não preenchido'} />
          </dl>
          <p className="mt-4 text-2xs text-muted">Os testes usam a configuração salva. Uma credencial cadastrada ainda precisa ser testada.</p>
          {dirty && <p className="mt-2 text-2xs text-accent">Salve as alterações antes de enviar um teste. A conexão usa os dados de servidor já salvos.</p>}
        </Surface>
        <Surface as="section" tone="base" className="lg:col-start-1 lg:row-start-1">
          <SurfaceHeader
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

            <GroupTitle className="mt-2 border-t border-line pt-4">Servidor de envio</GroupTitle>
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

            <GroupTitle className="mt-2 border-t border-line pt-4">Acesso ao produto</GroupTitle>
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
          </div>

          <SaveBar
            dirty={connectionDirty}
            saving={salvar.isPending}
            saveLabel="Salvar configuração"
            message={connectionDirty ? 'Conexão com alterações não salvas.' : 'Conexão salva.'}
            onSave={() =>
              salvar.mutate({
                provider: cfg.provider,
                fromName: cfg.fromName.trim(),
                fromEmail: cfg.fromEmail.trim(),
                smtp: cfg.smtp,
                accessUrl: cfg.accessUrl.trim(),
              })
            }
            extra={
              <>
                <Button variant="ghost" disabled={connectionDirty || cfg.provider === 'none'} loading={testarConexao.isPending} onClick={() => testarConexao.mutate(undefined)}>
                  Testar conexão
                </Button>
                <Button variant="ghost" disabled={dirty || cfg.provider === 'none'} onClick={() => setTesteAberto(true)}>
                  <Send />
                  Enviar e-mail de teste
                </Button>
              </>
            }
          />
        </Surface>
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
        <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Surface as="div" role="navigation" tone="elevated" className="p-3 sm:p-4" aria-label="Tipo de mensagem">
          <h3 className="mb-2 px-2 text-md font-bold">Mensagens do sistema</h3>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {templates.map(([id, meta]) => {
              const ativo = selecionado === id;
              const alterada = !sameValue(cfg.templates[id], base.templates[id]);
              return (
                <button
                  type="button"
                  key={id}
                  aria-pressed={ativo}
                  onClick={() => setSelecionado(id)}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs font-semibold transition-colors',
                    ativo
                      ? 'border-accent/40 bg-accent-soft text-accent inset-shadow-hi'
                      : 'border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <MessageSquare className="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
                  <span className="min-w-0">
                    {meta.label}
                    {alterada ? <small className="block text-3xs font-bold text-warn">Alterada</small> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 px-2 text-2xs text-muted">Troque de mensagem sem perder o que está editando.</p>
        </Surface>
        {templates.filter(([id]) => id === selecionado).map(([id, meta]) => (
          <Surface as="section" tone="base" key={id}>
            <SurfaceHeader
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
                  className="min-h-64 font-sans text-md leading-relaxed sm:text-sm"
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
              <details className="group border-t border-line">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
                  Personalização automática da mensagem
                  <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="text-sm text-muted">Copie a variável para o texto. No envio, ela será substituída pelo dado correspondente.</p>
                <div className="mt-3 flex flex-wrap gap-2 pb-1">
                  {meta.vars.map((v) => (
                    <code
                      key={v}
                      title={VAR_HELP[v] ?? v}
                      className="rounded-sm bg-surface-2 px-2 py-1.5 font-mono text-2xs text-ink-2 inset-shadow-hi"
                    >
                      {`{{${v}}}`} — {VAR_HELP[v] ?? v}
                    </code>
                  ))}
                </div>
              </details>
            </div>
            <SaveBar
              dirty={templatesDirty}
              saving={salvar.isPending}
              saveLabel="Salvar mensagens"
              message={templatesDirty ? 'Salva todas as mensagens alteradas neste formulário.' : 'Mensagens salvas.'}
              onSave={() => salvar.mutate({ templates: cfg.templates })}
            />
          </Surface>
        ))}
        </div>
      </TabsContent>

      {/* -------------------------------------------------- Automação --- */}
      <TabsContent value="automacao">
        <Surface as="section" tone="base">
          <SurfaceHeader
            title="Recuperação automática"
            hint="Defina quando lembrar o cliente de concluir a compra. Cada regra mantém o controle de um envio por abandono."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Surface as="section" tone="stat" className="grid content-start gap-4">
              <SurfaceHeader icon={<Workflow />} title="Checkout não concluído" hint="Para quem preencheu os dados e não gerou o Pix." className="mb-0" />
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
              <p className="border-t border-line pt-3 text-2xs text-muted">{cfg.recovery.checkoutAbandonedEnabled ? `Enviar após ${cfg.recovery.checkoutAbandonedAfterMin} minutos sem concluir.` : 'Automação desativada.'}</p>
            </Surface>
            <Surface as="section" tone="stat" className="grid content-start gap-4">
              <SurfaceHeader icon={<History />} title="Pix expirado" hint="Para quem gerou o código e deixou o prazo terminar." className="mb-0" />
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
              <p className="border-t border-line pt-3 text-2xs text-muted">{cfg.recovery.pixAbandonedEnabled ? `Enviar após ${cfg.recovery.pixAbandonedAfterMin} minutos da expiração.` : 'Automação desativada.'}</p>
            </Surface>
          </div>
          <SaveBar
            dirty={recoveryDirty}
            saving={salvar.isPending}
            saveLabel="Salvar automação"
            message={recoveryDirty ? 'Regras de automação com alterações não salvas.' : 'Automação salva.'}
            onSave={() => salvar.mutate({ recovery: cfg.recovery })}
          />
        </Surface>
      </TabsContent>

      {/* -------------------------------------------------- Histórico --- */}
      <TabsContent value="historico">
        <Surface as="section" tone="base">
          <SurfaceHeader title="Últimos 20 envios" hint="Tentativas mais recentes de envio e retorno do provedor." action={<Button variant="ghost" onClick={atualizar}><RefreshCw /> Atualizar</Button>} />
          {dados.recent.length === 0 ? (
            <Empty>Nenhum e-mail enviado ainda.</Empty>
          ) : (
            <Table stackBelow="sm" caption="Últimos 20 envios de e-mail">
              <THead>
                <tr>
                  <TH>Quando</TH>
                  <TH>Para</TH>
                  <TH>Template</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {dados.recent.map((log) => (
                  <TRow key={log.id}>
                    <TD label="Quando" muted>{quando(log.sentAt ?? log.createdAt)}</TD>
                    <TD label="Para">{log.to}</TD>
                    <TD label="Template" muted>{dados.meta[log.template]?.label ?? log.template}</TD>
                    <TD label="Status">
                      {log.status === 'enviado' ? (
                        <Badge tom="paid">enviado</Badge>
                      ) : (
                        <span className="flex flex-col gap-1">
                          <Badge tom="danger">falhou</Badge>
                          {log.error ? <ErroEnvio texto={log.error} /> : null}
                        </span>
                      )}
                    </TD>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </Surface>
      </TabsContent>
    </Tabs>
    </fieldset>
    </div>
  );
}
