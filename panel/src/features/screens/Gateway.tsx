import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, KeyRound, QrCode, Store, XCircle } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { GatewayId, GatewayResponse, GatewayTestResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldGrid,
  Input,
  SecretInput,
  Select,
  coletarSecrets,
  secretVazio,
  type SecretState,
} from '@/components/ui/form';
import { Badge, Callout, Card, CardTitle, ErrorState, GroupTitle, Loading } from '@/components/ui/layout';
import { chaves, useAcao } from '../hooks';
import { CardForm } from '../SecaoConfig';

/* ==========================================================================
   Gateway de pagamento

   Os três provedores ficam prontos e visíveis, com as credenciais que cada um
   exige. O que decide qual atende a venda é `resolveGateway` no servidor:
   provedor escolhido **E** credencial presente — escolher Mercado Pago sem
   token cai no Pix estático, que sem chave gera um código de demonstração. É
   melhor do que derrubar o checkout com "provedor não configurado" na cara do
   comprador, e é por isso que esta tela mostra em que estado cada um está em
   vez de só listar campos.
   ========================================================================== */

interface Provedor {
  id: GatewayId;
  nome: string;
  resumo: string;
  icone: typeof CreditCard;
  chaves: { key: string; label: string; hint?: string; obrigatoria: boolean }[];
}

const PROVEDORES: Provedor[] = [
  {
    id: 'static_pix',
    nome: 'Pix estático',
    resumo: 'Sua chave Pix, baixa manual. Funciona sem integração nenhuma.',
    icone: QrCode,
    chaves: [
      { key: 'pix.key', label: 'Chave Pix', hint: 'CPF/CNPJ, e-mail, telefone ou chave aleatória.', obrigatoria: true },
      {
        key: 'pix.merchantName',
        label: 'Nome do recebedor',
        hint: 'Como aparece no app do banco. Até 25 caracteres.',
        obrigatoria: true,
      },
      { key: 'pix.merchantCity', label: 'Cidade do recebedor', hint: 'Sem acento. Ex.: SAO PAULO', obrigatoria: true },
    ],
  },
  {
    id: 'mercadopago',
    nome: 'Mercado Pago',
    resumo: 'Pix transparente pela API, com confirmação automática por webhook.',
    icone: CreditCard,
    chaves: [
      {
        key: 'mp.accessToken',
        label: 'Access token',
        hint: 'Credenciais › Access token. O de teste começa com TEST-.',
        obrigatoria: true,
      },
      {
        key: 'mp.webhookSecret',
        label: 'Segredo do webhook',
        hint: 'Suas integrações › Webhooks › "Chave secreta". Sem ele, nenhuma notificação é aceita.',
        obrigatoria: true,
      },
    ],
  },
  {
    id: 'appmax',
    nome: 'Appmax',
    resumo: 'Pix pela API v1 da Appmax, com confirmação automática por webhook.',
    icone: Store,
    chaves: [
      {
        key: 'appmax.clientId',
        label: 'Client ID',
        hint: 'Gerado na instalação do aplicativo, no painel da Appmax.',
        obrigatoria: true,
      },
      { key: 'appmax.clientSecret', label: 'Client Secret', obrigatoria: true },
      {
        key: 'appmax.webhookToken',
        label: 'Segredo do webhook (você escolhe)',
        hint: 'Este não vem da Appmax: é um segredo seu. A Appmax não assina as notificações dela, então ele viaja na URL do webhook e é a única prova de que a notificação veio de lá. Sem ele, nenhuma notificação é aceita.',
        obrigatoria: true,
      },
    ],
  },
];

/** Onde cada provedor deve entregar as notificações. */
const WEBHOOKS: Partial<Record<GatewayId, { caminho: string; onde: string; nota?: string }>> = {
  mercadopago: {
    caminho: '/webhooks/mercadopago',
    onde: 'Suas integrações › Webhooks › URL de produção',
    nota: 'Marque só os eventos de "Pagamentos". A assinatura é conferida com a chave secreta que você colou acima.',
  },
  appmax: {
    caminho: '/webhooks/appmax?t=SEU_SEGREDO',
    onde: 'Painel da Appmax › Integrações › Webhook',
    nota: 'Troque SEU_SEGREDO pelo segredo do webhook que você cadastrou aqui. Ele não aparece nesta tela depois de salvo — se esquecer, cadastre outro.',
  },
};

export function TelaGateway() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.gateway,
    queryFn: () => api<GatewayResponse>('/gateway'),
  });

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }
  return <Formulario key={JSON.stringify(data)} inicial={data} />;
}

function CartaoProvedor({
  prov,
  ativo,
  estado,
  onClick,
}: {
  prov: Provedor;
  ativo: boolean;
  estado: 'pronto' | 'faltando' | 'vazio';
  onClick: () => void;
}) {
  const Icone = prov.icone;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'flex flex-col items-start gap-2 rounded-md border p-4 text-left transition-colors',
        ativo ? 'border-accent bg-accent-soft' : 'border-line-strong bg-bg hover:bg-surface-2',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn('flex items-center gap-2 font-bold', ativo ? 'text-accent' : 'text-ink')}>
          <Icone className="size-4.5" aria-hidden />
          {prov.nome}
        </span>
        {estado === 'pronto' ? (
          <Badge tom="paid">credenciais ok</Badge>
        ) : estado === 'faltando' ? (
          <Badge tom="pending">incompleto</Badge>
        ) : (
          <Badge>sem credencial</Badge>
        )}
      </span>
      <span className="text-xs text-muted">{prov.resumo}</span>
    </button>
  );
}

function Formulario({ inicial }: { inicial: GatewayResponse }) {
  /**
   * A URL do webhook é montada com a origem que o navegador está usando.
   *
   * Em desenvolvimento isso mostra `127.0.0.1:3100`, que não serve para o
   * provedor alcançar — e é bom que apareça assim: mostrar o domínio de
   * produção antes de existir domínio faria o dono cadastrar um endereço
   * morto no painel do gateway.
   */
  const origem = window.location.origin;
  const [ativo, setAtivo] = useState<GatewayId>(inicial.gatewayActive);
  const [modo, setModo] = useState(inicial.gatewayMode);
  const [expira, setExpira] = useState(String(inicial.pixExpiresMin));
  const [segredos, setSegredos] = useState<Record<string, SecretState>>({});
  const [teste, setTeste] = useState<GatewayTestResponse | null>(null);

  const jaTem = (key: string) => inicial.secrets[key] === true;

  const estadoDe = (prov: Provedor): 'pronto' | 'faltando' | 'vazio' => {
    const obrig = prov.chaves.filter((c) => c.obrigatoria);
    const tem = obrig.filter((c) => jaTem(c.key)).length;
    if (tem === 0) return 'vazio';
    return tem === obrig.length ? 'pronto' : 'faltando';
  };

  const salvar = useAcao(
    (corpo: Record<string, unknown>) => api<GatewayResponse>('/gateway', { method: 'PUT', body: corpo }),
    { sucesso: 'Gateway salvo. As credenciais foram cifradas antes de gravar.', invalidar: [chaves.gateway] },
  );

  const testar = useAcao(() => api<GatewayTestResponse>('/gateway/test', { method: 'POST' }), {
    onSuccess: (res) => setTeste(res),
  });

  const provedorAtivo = PROVEDORES.find((p) => p.id === ativo)!;

  return (
    <>
      <CardForm
        title="Gateway de pagamento"
        hint="As credenciais são gravadas cifradas (AES-256-GCM) e nunca voltam para esta tela — o servidor só informa se cada uma existe. Campo em branco mantém o valor atual."
        salvando={salvar.isPending}
        onSubmit={() =>
          salvar.mutate({
            gatewayActive: ativo,
            gatewayMode: modo,
            pixExpiresMin: Number(expira) || 30,
            secrets: coletarSecrets(segredos),
          })
        }
        extra={
          <Button variant="ghost" loading={testar.isPending} onClick={() => testar.mutate()}>
            Testar conexão
          </Button>
        }
      >
        <div>
          <GroupTitle>Quem processa a venda</GroupTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            {PROVEDORES.map((p) => (
              <CartaoProvedor
                key={p.id}
                prov={p}
                ativo={p.id === ativo}
                estado={estadoDe(p)}
                onClick={() => {
                  setAtivo(p.id);
                  setTeste(null);
                }}
              />
            ))}
          </div>
        </div>

        <FieldGrid>
          <Field label="Ambiente" hint="Sandbox usa as credenciais de teste do provedor.">
            <Select value={modo} onChange={(e) => setModo(e.target.value as 'sandbox' | 'production')}>
              <option value="sandbox">Sandbox (testes)</option>
              <option value="production">Produção (dinheiro real)</option>
            </Select>
          </Field>
          <Field label="O Pix expira em (minutos)" hint="Entre 5 e 1440. Depois disso o pedido vira 'expirado'.">
            <Input inputMode="numeric" value={expira} onChange={(e) => setExpira(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </FieldGrid>

        {modo === 'production' ? (
          <Callout tom="warn">
            Modo produção: as cobranças passam a ser <strong>reais</strong>. Confirme que as credenciais
            coladas são as de produção, e não as de teste — um token de teste em produção gera Pix que
            ninguém consegue pagar.
          </Callout>
        ) : null}

        <div>
          <GroupTitle>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="size-3.5" aria-hidden />
              Credenciais do {provedorAtivo.nome}
            </span>
          </GroupTitle>
          <div className="grid gap-4">
            {provedorAtivo.chaves.map((c) => (
              <SecretInput
                key={c.key}
                label={c.label + (c.obrigatoria ? '' : ' (opcional)')}
                hint={c.hint}
                isSet={jaTem(c.key)}
                state={segredos[c.key] ?? secretVazio}
                onChange={(s) => setSegredos((m) => ({ ...m, [c.key]: s }))}
              />
            ))}
          </div>
        </div>

        {WEBHOOKS[ativo] ? (
          <div>
            <GroupTitle>URL do webhook</GroupTitle>
            <p className="mb-2 text-sm text-muted">
              Cadastre este endereço em <strong>{WEBHOOKS[ativo]!.onde}</strong>. É por ele que a
              confirmação do pagamento chega sem o cliente precisar ficar com a página aberta.
            </p>
            <code className="block overflow-x-auto rounded-sm border border-line bg-bg px-3 py-2.5 text-xs whitespace-nowrap text-ink">
              {origem}
              {WEBHOOKS[ativo]!.caminho}
            </code>
            {WEBHOOKS[ativo]!.nota ? (
              <p className="mt-2 text-2xs text-muted">{WEBHOOKS[ativo]!.nota}</p>
            ) : null}
          </div>
        ) : null}

        {teste ? (
          <Callout tom={teste.ok ? 'ok' : 'err'}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {teste.ok ? (
                <CheckCircle2 className="size-4" aria-hidden />
              ) : (
                <XCircle className="size-4" aria-hidden />
              )}
              <strong>{teste.detail}</strong>
            </span>
            {teste.provider ? (
              <span className="mt-1 block text-xs opacity-90">
                {teste.provider.label}
                {teste.provider.account ? ` · conta ${teste.provider.account}` : ''}
                {teste.provider.environment ? ` · ${teste.provider.environment}` : ''}
                {teste.provider.mismatch
                  ? ' · atenção: o tipo da credencial não bate com o ambiente escolhido'
                  : ''}
              </span>
            ) : null}
          </Callout>
        ) : null}
      </CardForm>

      <Card>
        <CardTitle
          title="Como a cobrança é escolhida"
          hint="Isto não é configuração: é o que o servidor faz, e ajuda a entender por que um Pix saiu simulado."
        />
        <ol className="grid list-decimal gap-2 pl-5 text-sm text-ink-2">
          <li>
            O provedor ativo é consultado. Se a credencial obrigatória dele estiver presente, ele
            processa.
          </li>
          <li>
            Faltando credencial, a venda cai no <strong>Pix estático</strong> — a página continua
            vendendo em vez de mostrar erro.
          </li>
          <li>
            Sem nem a chave Pix cadastrada, o checkout gera um{' '}
            <strong>código de demonstração</strong>: dá para testar o fluxo inteiro, mas ninguém
            consegue pagar de verdade.
          </li>
          <li>
            Confirmação de pagamento vem por webhook assinado e por consulta ao provedor — nunca do
            corpo da notificação. Notificação repetida não entrega duas vezes.
          </li>
        </ol>
      </Card>
    </>
  );
}
