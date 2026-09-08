import { useState } from 'react';
import { ExternalLink, LayoutTemplate } from 'lucide-react';
import type { CheckoutCfg } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Field, Input, ToggleRow } from '@/components/ui/form';
import { Callout } from '@/components/ui/layout';
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
    </CardForm>
  );
}
