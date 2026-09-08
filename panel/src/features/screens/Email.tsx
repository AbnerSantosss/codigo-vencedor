import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Send } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
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
  return <Conteudo key={JSON.stringify(data.email)} dados={data} />;
}

function Conteudo({ dados }: { dados: EmailResponse }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<EmailCfg>(dados.email);
  const [segredos, setSegredos] = useState<Record<string, SecretState>>({});
  const [conexao, setConexao] = useState<{ ok: boolean; detail?: string; error?: string } | null>(null);
  const [testeAberto, setTesteAberto] = useState(false);
  const [testeEmail, setTesteEmail] = useState('');
  const [testeTpl, setTesteTpl] = useState<TemplateId>('purchase_approved');

  const salvar = useAcao(
    (parcial: Partial<EmailCfg>) =>
      api<{ email: EmailCfg }>('/email', {
        method: 'PUT',
        body: { email: parcial, secrets: coletarSecrets(segredos) },
      }),
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

  return (
    <Tabs defaultValue="provedor">
      <TabsList>
        <TabsTrigger value="provedor">Provedor</TabsTrigger>
        <TabsTrigger value="templates">Templates</TabsTrigger>
        <TabsTrigger value="automacao">Automação</TabsTrigger>
        <TabsTrigger value="historico">Histórico</TabsTrigger>
      </TabsList>

      {/* --------------------------------------------------- Provedor --- */}
      <TabsContent value="provedor">
        <Card>
          <CardTitle
            title="Servidor de envio"
            hint="A senha de app fica cifrada na tabela Secret. Ela nunca aparece nesta tela, nem no .env, nem em log."
          />
          <div className="grid gap-4">
            <FieldGrid>
              <Field label="Provedor">
                <Select
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
              <Field label="Nome do remetente">
                <Input
                  maxLength={80}
                  value={cfg.fromName}
                  onChange={(e) => setCfg({ ...cfg, fromName: e.target.value })}
                />
              </Field>
              <Field label="E-mail do remetente" hint="Precisa ser a mesma conta autenticada no SMTP.">
                <Input
                  type="email"
                  value={cfg.fromEmail}
                  onChange={(e) => setCfg({ ...cfg, fromEmail: e.target.value })}
                />
              </Field>
            </FieldGrid>

            {cfg.provider === 'smtp' ? (
              <div>
                <GroupTitle>SMTP</GroupTitle>
                <div className="grid gap-4">
                  <FieldGrid>
                    <Field label="Servidor">
                      <Input
                        value={cfg.smtp.host}
                        placeholder="smtp.gmail.com"
                        onChange={(e) => setCfg({ ...cfg, smtp: { ...cfg.smtp, host: e.target.value } })}
                      />
                    </Field>
                    <Field label="Porta" hint="465 com TLS direto, 587 com STARTTLS.">
                      <Input
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
                    <Field label="Usuário">
                      <Input
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

            <Field
              label="Link de acesso ao produto"
              hint="Vai no e-mail de compra aprovada. Vazio = o e-mail manda o link da própria landing page como se fosse a área de acesso."
            >
              <Input
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
                É o campo mais urgente desta tela.
              </Callout>
            ) : null}

            {conexao ? (
              <Callout tom={conexao.ok ? 'ok' : 'err'}>
                {conexao.ok
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
                Salvar provedor
              </Button>
              <Button variant="ghost" loading={testarConexao.isPending} onClick={() => testarConexao.mutate(undefined)}>
                Testar conexão
              </Button>
              <Button variant="ghost" onClick={() => setTesteAberto(true)}>
                <Send />
                Enviar e-mail de teste
              </Button>
            </Actions>
          </div>
        </Card>

        <Dialog open={testeAberto} onOpenChange={setTesteAberto}>
          <DialogContent
            title="Enviar e-mail de teste"
            description="O template vai com dados fictícios (Maria, pedido CV-TESTE1) para o endereço que você escolher."
          >
            <div className="grid gap-4">
              <Field label="Enviar para">
                <Input
                  type="email"
                  autoFocus
                  value={testeEmail}
                  onChange={(e) => setTesteEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </Field>
              <Field label="Qual template">
                <Select value={testeTpl} onChange={(e) => setTesteTpl(e.target.value as TemplateId)}>
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
        {templates.map(([id, meta]) => (
          <Card key={id}>
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
                  Restaurar padrão
                </Button>
              }
            />
            <div className="grid gap-4">
              <Field label="Assunto">
                <Input
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
              <Field label="Corpo do e-mail">
                <Textarea
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
              <p className="text-2xs text-muted">
                Variáveis desta mensagem:{' '}
                {meta.vars.map((v) => (
                  <code
                    key={v}
                    className="mr-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-2xs text-ink"
                  >
                    {`{{${v}}}`}
                  </code>
                ))}
              </p>
            </div>
            <Actions>
              <Button loading={salvar.isPending} onClick={() => salvar.mutate({ templates: cfg.templates })}>
                Salvar templates
              </Button>
            </Actions>
          </Card>
        ))}
      </TabsContent>

      {/* -------------------------------------------------- Automação --- */}
      <TabsContent value="automacao">
        <Card>
          <CardTitle
            title="Recuperação automática"
            hint="Cada pessoa recebe cada e-mail uma vez só — o horário do envio é gravado antes de mandar, então nem uma falha do servidor gera dois e-mails para o mesmo abandono."
          />
          <div className="grid gap-4">
            <ToggleRow
              label="Avisar quem preencheu o formulário e não gerou o Pix"
              checked={cfg.recovery.checkoutAbandonedEnabled}
              onChange={(v) => setCfg({ ...cfg, recovery: { ...cfg.recovery, checkoutAbandonedEnabled: v } })}
            />
            {cfg.recovery.checkoutAbandonedEnabled ? (
              <FieldGrid>
                <Field label="Esperar quantos minutos" hint="Entre 5 e 1440.">
                  <Input
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

            <ToggleRow
              label="Avisar quem gerou o Pix e deixou expirar"
              checked={cfg.recovery.pixAbandonedEnabled}
              onChange={(v) => setCfg({ ...cfg, recovery: { ...cfg.recovery, pixAbandonedEnabled: v } })}
            />
            {cfg.recovery.pixAbandonedEnabled ? (
              <FieldGrid>
                <Field label="Esperar quantos minutos depois de expirar" hint="Entre 1 e 1440.">
                  <Input
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
          <CardTitle title="Últimos 20 envios" hint="O que o servidor tentou mandar, e o que o provedor respondeu." />
          {dados.recent.length === 0 ? (
            <Empty>Nenhum e-mail enviado ainda.</Empty>
          ) : (
            <TableWrap>
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
                              <span className="text-2xs whitespace-normal text-muted">{log.error}</span>
                            ) : null}
                          </span>
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
    </Tabs>
  );
}
