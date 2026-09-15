import { useState } from 'react';
import { ExternalLink, LayoutTemplate } from 'lucide-react';
import type { CheckoutCfg } from '@/lib/types';
import { cn } from '@/lib/cn';
import { brl, centavosDe, reaisDe } from '@/lib/format';
import { Field, Input, ToggleRow } from '@/components/ui/form';
import { Callout, Divider } from '@/components/ui/layout';
import { ComConfig, CardForm } from '../SecaoConfig';
import { useSalvarConfig } from '../hooks';

/**
 * Como o cliente paga.
 *
 * Os dois modos continuam sendo os mesmos do backend (`checkoutSchema`):
 * `embedded` (formulário + QR na página) e `link` (um botão que leva para um
 * checkout externo). O modo link é o que permite vender antes de qualquer
 * gateway estar integrado — e continua aqui exatamente como estava, por
 * pedido do dono.
 *
 * A escolha virou dois cartões em vez de um `<select>`: são duas decisões de
 * negócio diferentes, e num `<select>` fechado o dono não via que a segunda
 * existia.
 */
export function TelaCheckout() {
  return <ComConfig>{(cfg) => <Formulario key={JSON.stringify(cfg.checkout)} inicial={cfg.checkout} />}</ComConfig>;
}

function OpcaoModo({
  ativo,
  onClick,
  icone: Icone,
  titulo,
  texto,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: typeof LayoutTemplate;
  titulo: string;
  texto: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'flex min-h-24 flex-col items-start gap-1.5 rounded-md border p-4 text-left transition-colors',
        ativo
          ? 'border-accent bg-accent-soft'
          : 'border-line-strong bg-bg hover:border-line-strong hover:bg-surface-2',
      )}
    >
      <span className={cn('flex items-center gap-2 font-bold', ativo ? 'text-accent' : 'text-ink')}>
        <Icone className="size-4.5" aria-hidden />
        {titulo}
      </span>
      <span className="text-xs text-muted">{texto}</span>
    </button>
  );
}

function Formulario({ inicial }: { inicial: CheckoutCfg }) {
  const salvar = useSalvarConfig();
  const [modo, setModo] = useState<CheckoutCfg['mode']>(inicial.mode);
  const [url, setUrl] = useState(inicial.externalUrl);
  const [rotulo, setRotulo] = useState(inicial.buttonLabel);
  const [novaAba, setNovaAba] = useState(inicial.openInNewTab);
  const [simulado, setSimulado] = useState(inicial.simulatedPaymentEnabled);
  const [cupons, setCupons] = useState(inicial.couponsEnabled);
  const [minimo, setMinimo] = useState(reaisDe(inicial.pixMinCents));

  /* O servidor aceita de R$ 1,00 a R$ 1.000,00. Repetido aqui para o dono ver
     o problema antes de salvar, não no toast de erro. */
  const minimoCents = centavosDe(minimo);
  const minimoInvalido = minimoCents < 100 || minimoCents > 100_000;

  const ehLink = modo === 'link';
  const urlVazia = ehLink && !url.trim();

  return (
    <CardForm
      title="Como o cliente paga"
      hint="Checkout embutido converte mais e exige um gateway configurado. O botão para link externo não exige nada e serve para vender enquanto a integração não está pronta."
      salvando={salvar.isPending}
      onSubmit={() =>
        salvar.mutate({
          checkout: {
            mode: modo,
            externalUrl: url.trim(),
            buttonLabel: rotulo.trim(),
            openInNewTab: novaAba,
            simulatedPaymentEnabled: simulado,
            couponsEnabled: cupons,
            pixMinCents: minimoInvalido ? inicial.pixMinCents : minimoCents,
          },
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <OpcaoModo
          ativo={!ehLink}
          onClick={() => setModo('embedded')}
          icone={LayoutTemplate}
          titulo="Na própria página"
          texto="Formulário, Pix copia-e-cola e QR Code dentro da LP. Precisa de gateway configurado."
        />
        <OpcaoModo
          ativo={ehLink}
          onClick={() => setModo('link')}
          icone={ExternalLink}
          titulo="Botão para link externo"
          texto="Os CTAs levam para um link de pagamento pronto (Appmax, Hotmart, Kiwify, Mercado Pago…)."
        />
      </div>

      {ehLink ? (
        <>
          <Callout tom="warn">
            No modo link a seção de checkout <strong>sai da página</strong> e os quatro CTAs passam a
            apontar para a URL. Sem URL preenchida o modo é ignorado e o formulário continua — melhor
            isso do que uma página sem caminho de compra.
          </Callout>

          <Field
            label="URL do checkout externo"
            hint="Link de pagamento da Appmax, Hotmart, Kiwify, Mercado Pago…"
            error={urlVazia ? 'Preencha a URL, senão o modo link não entra em vigor.' : null}
            htmlFor="url-externa"
          >
            <Input
              id="url-externa"
              type="url"
              inputMode="url"
              placeholder="https://pay.exemplo.com.br/seu-produto"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={urlVazia || undefined}
            />
          </Field>

          <Field label="Texto do botão" htmlFor="rotulo">
            <Input
              id="rotulo"
              maxLength={60}
              placeholder="Quero garantir minha vaga"
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
            />
          </Field>

          <ToggleRow
            label="Abrir em nova aba"
            hint="Mantém sua página aberta enquanto o comprador paga."
            checked={novaAba}
            onChange={setNovaAba}
          />
        </>
      ) : (
        <Callout tom="info">
          O checkout embutido usa o provedor configurado na tela <strong>Gateway</strong>. Sem
          credencial, ele gera um Pix de demonstração — que serve para testar o fluxo, mas ninguém
          consegue pagar.
        </Callout>
      )}

      <Divider />

      {/* ------------------------------------------------ Compra de teste --- */}
      <ToggleRow
        label="Permitir pagamento simulado (compra de teste)"
        hint="Libera o botão “já paguei” na tela do Pix, que marca o pedido como pago sem dinheiro nenhum."
        checked={simulado}
        onChange={setSimulado}
      />

      {simulado ? (
        <Callout tom="err">
          <strong>Isto entrega o produto de graça.</strong> O pedido vira <strong>pago</strong>, o e-mail
          de acesso sai, a venda é enviada para a API de Conversões da Meta e para os webhooks — igual a
          uma compra de verdade, e depois some do faturamento real. Pior: a rota aceita qualquer pessoa
          que chegue ao checkout, não só você. Ligue, teste, <strong>desligue</strong>. Em produção isso
          fica desligado.
          <br />
          Para testar cobrando de verdade, use um <strong>cupom</strong>: ele gera um Pix real pelo mínimo
          e o fluxo inteiro acontece de ponta a ponta.
        </Callout>
      ) : (
        <Callout tom="info">
          Desligado, a página nem mostra o aviso de Pix simulado e a rota responde “não encontrado”. É
          assim que deve ficar em produção.
        </Callout>
      )}

      <Divider />

      {/* -------------------------------------------------------- Cupons --- */}
      <ToggleRow
        label="Aceitar cupom de desconto"
        hint="Mostra o campo “tem um cupom?” no checkout. Os códigos são criados na tela Cupons."
        checked={cupons}
        onChange={setCupons}
      />

      {cupons ? (
        <Callout tom="info">
          O campo só aparece com esta chave ligada. Enquanto não houver cupom criado na tela{' '}
          <a className="font-semibold text-accent underline underline-offset-4" href="#cupons">
            Cupons
          </a>
          , qualquer código digitado é recusado — o que é o comportamento certo, mas mostra um campo que
          nunca funciona.
        </Callout>
      ) : null}

      <Field
        label="Valor mínimo cobrado no Pix"
        hint={`Piso do pedido depois do cupom. Um cupom de 100% resulta neste valor, nunca em R$ 0,00 — Pix sem valor não existe para gateway nenhum, e o pedido nasceria impossível de pagar. Hoje: ${brl(minimoInvalido ? inicial.pixMinCents : minimoCents)}.`}
        error={
          minimoInvalido
            ? `Fora da faixa aceita (R$ 1,00 a R$ 1.000,00). Salvando assim, o valor atual (${brl(inicial.pixMinCents)}) é mantido.`
            : null
        }
        htmlFor="pix-minimo"
      >
        <Input
          id="pix-minimo"
          inputMode="decimal"
          value={minimo}
          onChange={(e) => setMinimo(e.target.value)}
          aria-invalid={minimoInvalido || undefined}
        />
      </Field>
    </CardForm>
  );
}
