import { useState } from 'react';
import { Tag } from 'lucide-react';
import { brl, centavosDe, reaisDe } from '@/lib/format';
import { Field, FieldGrid, Input, ToggleRow } from '@/components/ui/form';
import { Badge, Callout } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { SaveBar } from '@/components/ui/save-bar';
import { ComConfig } from '../SecaoConfig';
import { useSalvarConfig } from '../hooks';

export function TelaConteudo() {
  return <ComConfig>{(cfg) => <Formulario key={JSON.stringify(cfg.content)} inicial={cfg.content} />}</ComConfig>;
}

function Formulario({ inicial }: { inicial: import('@/lib/types').Content }) {
  const salvar = useSalvarConfig();
  const [preco, setPreco] = useState(reaisDe(inicial.priceCents));
  const [de, setDe] = useState(reaisDe(inicial.priceFromCents));
  const [nome, setNome] = useState(inicial.productName);
  const [video, setVideo] = useState(inicial.videoEnabled);

  const centavos = centavosDe(preco);
  const centavosDePor = centavosDe(de);
  const precoInvalido = centavos < 100;
  const deMenorQuePreco = centavosDePor > 0 && centavosDePor < centavos;

  const sujo =
    centavos !== inicial.priceCents ||
    centavosDePor !== inicial.priceFromCents ||
    nome.trim() !== inicial.productName ||
    video !== inicial.videoEnabled;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate({
          content: {
            priceCents: centavos,
            priceFromCents: centavosDePor,
            currency: 'BRL',
            productName: nome.trim(),
            videoEnabled: video,
          },
        });
      }}
    >
      <Surface as="section" tone="base" className="mb-5 max-w-[52rem]">
        <SurfaceHeader
          icon={<Tag />}
          title="Conteúdo da oferta"
          hint="O preço entra na página, no título da aba, no preview de link do WhatsApp e nos dados estruturados do Google — por isso mudar aqui muda o que aparece no Google, sem redeploy."
          action={sujo ? <Badge tom="pending">alterações não salvas</Badge> : null}
        />
        <div className="grid gap-4">
          <FieldGrid>
            <Field
              label="Preço de venda (R$)"
              hint={precoInvalido ? undefined : `A página vai mostrar ${brl(centavos)}.`}
              error={precoInvalido ? 'O preço precisa ser de pelo menos R$ 1,00.' : null}
              htmlFor="preco"
            >
              <Input
                id="preco"
                inputMode="decimal"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
                aria-invalid={precoInvalido || undefined}
              />
            </Field>
            <Field
              label='Valor "de" (R$)'
              hint="O preço riscado, para dar a âncora de desconto."
              error={deMenorQuePreco ? 'O valor "de" precisa ser maior que o preço de venda.' : null}
              htmlFor="de"
            >
              <Input
                id="de"
                inputMode="decimal"
                value={de}
                onChange={(e) => setDe(e.target.value)}
                aria-invalid={deMenorQuePreco || undefined}
              />
            </Field>
          </FieldGrid>

          <Field label="Nome do produto" htmlFor="nome">
            <Input id="nome" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />
          </Field>

          <ToggleRow
            label="Mostrar a seção de vídeo"
            hint='Desligar remove o bloco "Entenda a ferramenta em ação".'
            checked={video}
            onChange={setVideo}
          />

          {centavos !== 9700 ? (
            <Callout tom="warn" className="mb-0">
              O preço combinado do produto é <strong>R$ 97,00 por mês</strong>. Você está prestes a publicar{' '}
              <strong>{brl(centavos)}</strong> — confira antes de salvar.
            </Callout>
          ) : null}
        </div>

        <SaveBar
          submit
          dirty={sujo}
          saving={salvar.isPending}
          saveLabel="Salvar conteúdo"
          message={sujo ? 'Alterações não salvas.' : 'Conteúdo salvo.'}
        />
      </Surface>
    </form>
  );
}
