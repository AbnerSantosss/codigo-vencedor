import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Palette, MousePointer2, Layers, Type, Square, ExternalLink, RotateCcw, ChevronDown } from 'lucide-react';
import { useDraft } from '../useDraft';
import type { Theme } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ColorInput, Field, FieldGrid, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { SaveBar } from '@/components/ui/save-bar';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { ComConfig } from '../SecaoConfig';
import { chaves, useAcao } from '../hooks';

const GRUPOS: { titulo: string; nota?: string; chaves: [string, string][] }[] = [
  {
    titulo: 'Marca e destaques',
    nota: 'A cor principal e suas variações na página de vendas.',
    chaves: [
      ['accent', 'Destaque (amarelo)'],
      ['accent-hover', 'Destaque ao passar o mouse'],
      ['accent-soft', 'Destaque — fundo suave'],
      ['accent-ghost', 'Destaque — fundo muito suave'],
    ],
  },
  {
    titulo: 'Botões e avisos',
    nota: 'Cores das ações de compra, da urgência e das mensagens de erro.',
    chaves: [
      ['cta', 'Botão de compra'],
      ['cta-hover', 'Botão ao passar o mouse'],
      ['cta-ink', 'Texto do botão de compra'],
      ['alert-bg', 'Barra de urgência'],
      ['alert-ink', 'Texto da barra de urgência'],
      ['danger', 'Erro'],
    ],
  },
  {
    titulo: 'Fundos e bordas',
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
    titulo: 'Textos',
    chaves: [
      ['text', 'Texto principal'],
      ['text-2', 'Texto secundário'],
      ['text-3', 'Texto complementar'],
      ['muted', 'Texto de apoio'],
      ['muted-2', 'Apoio — menos destaque'],
      ['muted-3', 'Apoio — mínimo destaque'],
    ],
  },
];

const ICONS = [Palette, MousePointer2, Layers, Type];
const PRINCIPAIS = new Set(['accent', 'cta', 'cta-ink', 'alert-bg', 'bg', 'surface', 'border', 'text', 'text-2']);
const AMOSTRAS = [
  ['accent', 'Marca'],
  ['cta', 'Compra'],
  ['bg', 'Fundo'],
  ['text', 'Texto'],
] as const;

export function TelaAparencia() {
  return <ComConfig>{(cfg) => <Formulario inicial={cfg.theme} />}</ComConfig>;
}

/** Tile do ícone de um grupo de cores. */
function IconeGrupo({ icone: Icone }: { icone: typeof Palette }) {
  return (
    <span
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent inset-shadow-hi [&_svg]:size-5"
      aria-hidden
    >
      <Icone />
    </span>
  );
}

function Formulario({ inicial }: { inicial: Theme }) {
  const draft = useDraft(inicial);
  const { value: tema, setValue: setTema, base, dirty } = draft;
  const [aberto, setAberto] = useState(false);
  const salvar = useAcao(async (submitted: Theme) => {
    const res = await api<{ config: { theme: Theme } }>('/config', { method: 'PUT', body: { theme: submitted } });
    draft.accept(submitted, res.config.theme);
    return res;
  }, { sucesso: 'Aparência salva. A landing page já usa os novos valores.', invalidar: [chaves.config] });
  const restaurar = useAcao(() => api<{ theme: Theme }>('/config/theme/reset', { method: 'POST' }), {
    sucesso: 'Aparência original restaurada.', invalidar: [chaves.config],
    onSuccess: (res) => { setTema(res.theme); draft.accept(res.theme, res.theme); setAberto(false); },
  });
  const setCor = (chave: string, valor: string) => setTema((t) => ({ ...t, [chave]: valor }));
  const erro = (chave: string) => salvar.error instanceof ApiError ? salvar.error.data.issues?.find((i) => i.campo === `theme.${chave}`)?.erro : undefined;
  const totalCores = GRUPOS.reduce((n, g) => n + g.chaves.length, 0);

  const campo = ([chave, label]: [string, string]) => {
    const valor = tema[chave] ?? '';
    // O seletor nativo só representa hexa; para `rgba(...)` ele fica
    // desabilitado e a amostra abaixo mostra a cor no lugar dele.
    const mostraAmostra = valor !== '' && !/^#[0-9a-f]{6}$/i.test(valor);
    return (
      <Field key={chave} label={label} htmlFor={`theme-${chave}`} error={erro(chave)}>
        <div className="relative min-w-0">
          {mostraAmostra ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 z-[1] size-11 overflow-hidden rounded-sm border border-line-strong bg-surface-2"
            >
              <i className="block h-full w-full" style={{ backgroundColor: valor }} />
            </span>
          ) : null}
          <ColorInput id={`theme-${chave}`} value={valor} onChange={(v) => setCor(chave, v)} />
        </div>
      </Field>
    );
  };

  const botaoRestaurar = (
    <Button variant="ghost" block onClick={() => setAberto(true)}>
      <RotateCcw /> Restaurar padrão
    </Button>
  );

  return (
    <div className="min-w-0">
      <SurfaceHeader
        eyebrow="Identidade visual"
        icon={<Palette />}
        title="Aparência da landing page"
        hint="Personalize as cores e os cantos do site de vendas."
        action={dirty ? <Badge tom="pending">alterações não salvas</Badge> : <Badge tom="paid">aparência salva</Badge>}
      />

      <form onSubmit={(e) => { e.preventDefault(); salvar.mutate(tema); }}>
        <fieldset disabled={salvar.isPending || restaurar.isPending} className="min-w-0">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
            {/* ------------------------------------------------- Resumo --- */}
            <Surface as="section" tone="elevated" className="lg:col-start-2 lg:row-start-1" aria-label="Resumo">
              <SurfaceHeader icon={<Palette />} title="Sua paleta" />
              <p className="text-sm text-muted">
                Estas amostras acompanham a edição. As mudanças só chegam ao site ao salvar.
              </p>
              <div className="my-5 grid max-w-[16rem] grid-cols-4 gap-2.5">
                {AMOSTRAS.map(([key, label]) => (
                  <div key={key} className="min-w-0">
                    <span
                      className="block aspect-square rounded-md border border-line-strong inset-shadow-hi"
                      style={{ backgroundColor: tema[key] }}
                    />
                    <small className="mt-1.5 block text-center text-3xs text-muted">{label}</small>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted">{totalCores} cores e o formato dos cantos.</p>
              <Button asChild variant="ghost" block className="mt-4">
                <a href="/" target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Abrir landing page
                </a>
              </Button>
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-2.5 text-2xs text-muted">Para voltar à identidade original:</p>
                {botaoRestaurar}
              </div>
            </Surface>

            {/* ------------------------------------------------- Grupos --- */}
            <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-start-1">
              {GRUPOS.map((grupo, index) => {
                const Icone = ICONS[index]!;
                const principais = grupo.chaves.filter(([key]) => PRINCIPAIS.has(key));
                const avancadas = grupo.chaves.filter(([key]) => !PRINCIPAIS.has(key));
                const nota = grupo.nota ?? (index === 2 ? 'Superfícies que organizam o conteúdo.' : 'Hierarquia de leitura e textos de apoio.');
                return (
                  <Surface as="section" tone="base" key={grupo.titulo}>
                    <details open className="group">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                        <IconeGrupo icone={Icone} />
                        <span className="min-w-0 flex-1">
                          <strong className="block text-md font-bold">{grupo.titulo}</strong>
                          <small className="mt-0.5 block text-2xs text-muted">{nota}</small>
                        </span>
                        <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <div className="mt-5">
                        <FieldGrid>{principais.map(campo)}</FieldGrid>
                        {avancadas.length ? (
                          <details className="group/adv mt-5 border-t border-line">
                            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
                              Ajustes avançados
                              <span className="text-3xs text-muted">{avancadas.length} opções</span>
                              <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform group-open/adv:rotate-180" aria-hidden />
                            </summary>
                            <div className="pb-1"><FieldGrid>{avancadas.map(campo)}</FieldGrid></div>
                          </details>
                        ) : null}
                      </div>
                    </details>
                  </Surface>
                );
              })}

              <Surface as="section" tone="base">
                <SurfaceHeader icon={<Square />} title="Cantos dos elementos" />
                <div className="grid items-center gap-4 sm:grid-cols-2 sm:gap-6">
                  <Field label="Arredondamento" hint="Use um valor CSS, por exemplo: 12px." htmlFor="radius">
                    <Input id="radius" value={tema.radius ?? ''} placeholder="12px" onChange={(e) => setCor('radius', e.target.value)} />
                  </Field>
                  <div
                    className="border border-accent/50 bg-accent-soft px-3 py-6 text-center text-xs font-semibold text-accent"
                    style={{ borderRadius: tema.radius }}
                  >
                    Amostra do canto
                  </div>
                </div>
              </Surface>
            </div>
          </div>

          <SaveBar
            inset={false}
            submit
            dirty={dirty}
            saving={salvar.isPending}
            onReset={() => setTema(base)}
            saveLabel="Salvar aparência"
            message={dirty ? 'Sua edição está pronta para ser salva.' : 'Edite as opções acima para personalizar a página.'}
          />
        </fieldset>
      </form>

      <Dialog open={aberto} onOpenChange={setAberto}><DialogContent title="Restaurar a aparência original?" description="Todas as cores e os cantos voltarão ao padrão aprovado. Os ajustes atuais serão substituídos.">
        <p className="text-sm text-ink-2">Esta ação grava imediatamente na landing page. Não é necessário salvar depois e não há desfazer.</p>
        <DialogFooter><Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button><Button variant="danger" loading={restaurar.isPending} onClick={() => restaurar.mutate()}>Restaurar aparência original</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
