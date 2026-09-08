import { useState } from 'react';
import { api } from '@/lib/api';
import type { Theme } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ColorInput, Field, FieldGrid, Input } from '@/components/ui/form';
import { Callout, GroupTitle } from '@/components/ui/layout';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { ComConfig, CardForm } from '../SecaoConfig';
import { chaves, useAcao, useSalvarConfig } from '../hooks';

/**
 * Paleta da landing page.
 *
 * Os grupos existem porque a lista corrida de 24 cores não dizia o que
 * mexia em quê: "accent-ghost" no meio de "muted-2" obrigava a salvar e
 * abrir o site para descobrir. Agora identidade, superfície, texto e ação
 * ficam separados, e a ação (verde de compra, vermelho de urgência) fica
 * longe da identidade — que é justamente a distinção que o design aprovado
 * faz.
 */
const GRUPOS: { titulo: string; nota?: string; chaves: [string, string][] }[] = [
  {
    titulo: 'Identidade',
    nota: 'O amarelo da marca. Não é a cor do botão de compra.',
    chaves: [
      ['accent', 'Destaque (amarelo)'],
      ['accent-hover', 'Destaque — hover'],
      ['accent-soft', 'Destaque — fundo suave'],
      ['accent-ghost', 'Destaque — fundo fantasma'],
    ],
  },
  {
    titulo: 'Ação e urgência',
    nota: 'Verde é comprar, vermelho é o tempo acabando. Separados da identidade de propósito.',
    chaves: [
      ['cta', 'Botão de compra'],
      ['cta-hover', 'Botão de compra — hover'],
      ['cta-ink', 'Texto do botão de compra'],
      ['alert-bg', 'Barra de urgência'],
      ['alert-ink', 'Texto da barra de urgência'],
      ['danger', 'Erro'],
    ],
  },
  {
    titulo: 'Superfícies',
    chaves: [
      ['bg', 'Fundo da página'],
      ['surface', 'Card'],
      ['surface-alt', 'Card alternativo'],
      ['input', 'Campo de formulário'],
      ['icon-bg', 'Fundo de ícone'],
      ['border', 'Borda'],
      ['border-strong', 'Borda forte'],
    ],
  },
  {
    titulo: 'Texto',
    chaves: [
      ['text', 'Texto principal'],
      ['text-2', 'Texto secundário'],
      ['text-3', 'Texto terciário'],
      ['muted', 'Texto suave'],
      ['muted-2', 'Texto suave 2'],
      ['muted-3', 'Texto suave 3'],
    ],
  },
];

export function TelaAparencia() {
  return <ComConfig>{(cfg) => <Formulario key={JSON.stringify(cfg.theme)} inicial={cfg.theme} />}</ComConfig>;
}

function Formulario({ inicial }: { inicial: Theme }) {
  const salvar = useSalvarConfig();
  const [tema, setTema] = useState<Theme>({ ...inicial });
  const [aberto, setAberto] = useState(false);

  const restaurar = useAcao(() => api<{ theme: Theme }>('/config/theme/reset', { method: 'POST' }), {
    sucesso: 'Paleta restaurada para o padrão do designer.',
    invalidar: [chaves.config],
    onSuccess: (res) => {
      setTema(res.theme);
      setAberto(false);
    },
  });

  const setCor = (chave: string, valor: string) => setTema((t) => ({ ...t, [chave]: valor }));

  return (
    <CardForm
      wide
      title="Aparência da landing page"
      hint="Cada cor é uma variável que a página lê ao carregar. Salve e abra a landing page para conferir — o painel não desenha prévia da LP de propósito."
      salvando={salvar.isPending}
      onSubmit={() => salvar.mutate({ theme: tema })}
      extra={
        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild>
            <Button variant="ghost">Restaurar padrão do designer</Button>
          </DialogTrigger>
          <DialogContent
            title="Restaurar a paleta original?"
            description="Todas as 24 cores voltam ao valor do design aprovado. O que você tiver ajustado aqui é perdido."
          >
            <p className="text-sm text-ink-2">
              Isso grava direto: não precisa salvar depois, e não tem desfazer.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={restaurar.isPending} onClick={() => restaurar.mutate()}>
                Restaurar as cores originais
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <Callout tom="info">
        A regra do dono é <strong>não mexer no design da LP</strong>. Estas cores existem para ajuste
        fino e para a barra de urgência — mudar a identidade inteira aqui foge do que foi aprovado.
      </Callout>

      {GRUPOS.map((grupo) => (
        <div key={grupo.titulo}>
          <GroupTitle>{grupo.titulo}</GroupTitle>
          {grupo.nota ? <p className="mb-3 text-2xs text-muted">{grupo.nota}</p> : null}
          <FieldGrid>
            {grupo.chaves.map(([chave, label]) => (
              <Field key={chave} label={label}>
                <ColorInput value={tema[chave] ?? ''} onChange={(v) => setCor(chave, v)} />
              </Field>
            ))}
          </FieldGrid>
        </div>
      ))}

      <div>
        <GroupTitle>Forma</GroupTitle>
        <FieldGrid>
          <Field label="Raio das bordas" hint="Ex.: 12px" htmlFor="radius">
            <Input
              id="radius"
              value={tema.radius ?? ''}
              placeholder="12px"
              onChange={(e) => setCor('radius', e.target.value)}
            />
          </Field>
        </FieldGrid>
      </div>
    </CardForm>
  );
}
