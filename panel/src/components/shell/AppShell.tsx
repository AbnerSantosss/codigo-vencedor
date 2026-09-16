import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ExternalLink, LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { irPara } from '@/lib/router';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { PageBackdrop } from '@/components/ui/backdrop';
import { GRUPOS, TELAS, podeVer, telaPorId, type Tela } from './screens';

/* ==========================================================================
   Casca do painel

   O que muda em relação ao painel antigo, e por quê:

   • **Celular ganhou uma gaveta.** Antes a barra lateral virava uma faixa de
     13 links rolando na horizontal no topo: dava para navegar, mas era
     preciso adivinhar o que havia fora da tela. A gaveta mostra os três
     grupos inteiros de uma vez, com alvos de 48px.
   • **O cabeçalho da tela agora é fixo.** Em telas longas (Escassez,
     E-mail) o dono perdia a referência de onde estava depois de rolar.
   • **A casca é desenhada sempre**, mesmo com uma tela falhando — foi o
     conserto do "Carregando painel…" eterno, e continua sendo regra.

   F2 (casca profissional):

   • **Indicador de "tela ativa" que desliza.** Em vez de o destaque sumir de
     um item e aparecer no outro, um único `<span>` absoluto dentro do `<nav>`
     recebe `transform`/`height` medidos do item ativo e desliza até ele
     (referência: Dashboard Sidebar 21st.dev 14941, portado sem `motion`).
     A medida vai pela prop `style` do React (CSSOM, permitido pela CSP);
     a transição fica em classes Tailwind e o `prefers-reduced-motion`
     global de `app.css` a zera. Se a medição falhar (item não montado), o
     item ativo mantém o destaque estático de antes — nunca fica sem marca.
   • **`<main>` sobre `PageBackdrop`** (grade + ruído + halos) e cabeçalho
     sobre a superfície nova, com linha de luz interna e `backdrop-blur`.
   ========================================================================== */

function ItemDeMenu({
  tela,
  ativo,
  comIndicador,
  onNavegar,
}: {
  tela: Tela;
  ativo: boolean;
  /** O indicador deslizante já mediu este menu: o item deixa de pintar o
      próprio fundo/barra para não sobrepor o indicador. */
  comIndicador: boolean;
  onNavegar: () => void;
}) {
  const Icone = tela.icone;
  const destaqueEstatico = ativo && !comIndicador;
  return (
    <a
      href={`#${tela.id}`}
      aria-current={ativo ? 'page' : undefined}
      onClick={onNavegar}
      data-tela={tela.id}
      className={cn(
        'relative z-[1] flex min-h-12 items-center gap-2.5 rounded-sm px-3 text-md no-underline',
        'transition-colors duration-200 lg:min-h-10',
        ativo ? 'font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        // Barra à esquerda no item ativo: a cor de fundo sozinha é fraca
        // demais para dizer "você está aqui" numa lista de 14 itens.
        // Só é desenhada pelo item enquanto o indicador não assumiu.
        destaqueEstatico &&
          'bg-accent-soft before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r-[3px] before:bg-accent before:content-[""]',
      )}
    >
      <Icone
        className={cn(
          'size-4.5 shrink-0 transition-colors duration-200',
          ativo ? 'text-accent' : 'text-muted',
        )}
        aria-hidden
      />
      <span className="truncate">{tela.label}</span>
    </a>
  );
}

/**
 * Indicador deslizante: mede o `<a aria-current="page">` dentro do `<nav>`
 * (que é `relative`, logo é o `offsetParent`) e devolve `top`/`height`.
 * `null` enquanto não houver medida — aí os itens usam o destaque estático.
 */
function useIndicadorDeslizante(navRef: React.RefObject<HTMLElement | null>, telaAtual: string) {
  const [medida, setMedida] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const medir = () => {
      const ativo = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!ativo) {
        setMedida(null);
        return;
      }
      setMedida((atual) => {
        const top = ativo.offsetTop;
        const height = ativo.offsetHeight;
        return atual && atual.top === top && atual.height === height ? atual : { top, height };
      });
    };
    medir();

    // Fonte carregando, largura do painel mudando (desktop ↔ tablet) ou um
    // grupo ganhando/perdendo itens muda a posição — remede sem re-render.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [navRef, telaAtual]);

  return medida;
}

function MenuTelas({
  telaAtual,
  me,
  onNavegar,
}: {
  telaAtual: string;
  me: Me | null;
  onNavegar: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const medida = useIndicadorDeslizante(navRef, telaAtual);

  return (
    <nav ref={navRef} className="relative flex flex-col gap-0.5 px-2" aria-label="Telas do painel">
      {medida ? (
        <span
          aria-hidden
          // `left-2 right-2` casa com o `px-2` do nav; o `before` (barra
          // dourada) fica em `-left-2`, isto é, na borda do próprio nav —
          // mesma posição da barra estática de antes.
          className={cn(
            'pointer-events-none absolute top-0 right-2 left-2 rounded-sm bg-accent-soft inset-shadow-hi',
            'transition-[transform,height] duration-300 ease-out-soft',
            'before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r-[3px] before:bg-accent before:content-[""]',
          )}
          style={{ transform: `translateY(${medida.top}px)`, height: `${medida.height}px` }}
        />
      ) : null}
      {GRUPOS.map((grupo) => {
        const itens = TELAS.filter((t) => t.grupo === grupo && podeVer(t, me?.role));
        if (!itens.length) return null;
        return (
          <div key={grupo} className="contents">
            <div className="px-3 pt-4 pb-1 text-3xs font-bold tracking-widest text-muted uppercase">
              {grupo}
            </div>
            {itens.map((t) => (
              <ItemDeMenu
                key={t.id}
                tela={t}
                ativo={t.id === telaAtual}
                comIndicador={medida !== null}
                onNavegar={onNavegar}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Marca({ className }: { className?: string }) {
  return (
    <div className={cn('text-xl leading-none font-extrabold tracking-tight', className)}>
      Código <span className="text-accent">Vencedor</span>
    </div>
  );
}

function Rodape({ me, onSair }: { me: Me | null; onSair: () => void }) {
  return (
    <div className="mt-auto border-t border-line px-5 pt-4">
      <a
        href="#conta"
        // 44px de altura: é um link de navegação de verdade (leva para Minha
        // conta) e no celular precisa de alvo de toque, não de altura de
        // rodapé decorativo.
        className="mb-2 flex min-h-11 items-center text-xs break-all text-muted no-underline hover:text-accent"
        title="Minha conta"
      >
        {me?.name ? `${me.name} · ` : ''}
        {me?.email}
        {me?.role === 'owner' ? ' · administrador' : ''}
      </a>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onSair}>
          <LogOut />
          Sair
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href="/" target="_blank" rel="noreferrer noopener">
            <ExternalLink />
            Ver o site
          </a>
        </Button>
      </div>
    </div>
  );
}

export function AppShell({
  telaAtual,
  me,
  onSair,
  children,
}: {
  telaAtual: string;
  me: Me | null;
  onSair: () => void;
  children: React.ReactNode;
}) {
  const [gaveta, setGaveta] = useState(false);
  const tela = telaPorId(telaAtual);

  /* Trocar de tela fecha a gaveta e volta ao topo — sem isso a tela nova
     aparece rolada no meio, no lugar onde a anterior estava. */
  useEffect(() => {
    setGaveta(false);
    window.scrollTo({ top: 0 });
  }, [telaAtual]);

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15rem_1fr]">
      {/* ---------------------------------------------------- Desktop --- */}
      <aside className="sticky top-0 hidden h-svh flex-col gap-2 overflow-y-auto border-r border-line bg-surface py-5 inset-shadow-hi lg:flex">
        <div className="px-5">
          <Marca />
          <p className="mt-1 text-2xs text-muted">Painel administrativo</p>
        </div>
        <MenuTelas telaAtual={telaAtual} me={me} onNavegar={() => undefined} />
        <Rodape me={me} onSair={onSair} />
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* ------------------------------------------ Cabeçalho fixo --- */}
        {/* Sem a classe `cv-surface` aqui: ela fixa `position: relative`
            fora de camada e venceria o `sticky` do Tailwind. A superfície é
            composta direto com os tokens (surface + linha de luz + blur). */}
        <header className="sticky top-0 z-20 border-b border-line bg-surface/85 shadow-card backdrop-blur-md inset-shadow-hi">
          <div className="flex items-center gap-3 px-3.5 py-3 sm:px-6 lg:px-8">
            {/* Gaveta — só no celular e no tablet. */}
            <DialogPrimitive.Root open={gaveta} onOpenChange={setGaveta}>
              <DialogPrimitive.Trigger
                aria-label="Abrir o menu"
                className="grid size-12 shrink-0 place-items-center rounded-sm border border-line-strong bg-surface-2/60 text-ink transition-colors inset-shadow-hi hover:border-accent hover:text-accent lg:hidden"
              >
                <Menu className="size-5" />
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px] [animation:ad-fade-in_.15s_ease-out]" />
                <DialogPrimitive.Content
                  aria-label="Menu do painel"
                  className="fixed inset-y-0 left-0 z-50 flex w-[min(17rem,88vw)] flex-col gap-2 overflow-y-auto border-r border-line bg-surface py-5 shadow-float inset-shadow-hi [animation:ad-slide-in-left_.18s_ease-out]"
                >
                  <div className="flex items-start justify-between gap-2 px-5">
                    <div>
                      {/* Sem `asChild`: o Title precisa entregar as próprias
                          props de acessibilidade (é ele que dá nome ao
                          diálogo), e um componente intermediário as engoliria. */}
                      <DialogPrimitive.Title className="text-xl leading-none font-extrabold tracking-tight">
                        Código <span className="text-accent">Vencedor</span>
                      </DialogPrimitive.Title>
                      <p className="mt-1 text-2xs text-muted">Painel administrativo</p>
                    </div>
                    <DialogPrimitive.Close
                      aria-label="Fechar o menu"
                      className="grid size-12 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <X className="size-4.5" />
                    </DialogPrimitive.Close>
                  </div>
                  <MenuTelas telaAtual={telaAtual} me={me} onNavegar={() => setGaveta(false)} />
                  <Rodape me={me} onSair={onSair} />
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-extrabold tracking-tight">
                {tela?.titulo ?? 'Painel'}
              </h1>
            </div>

            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex lg:hidden">
              <a href="/" target="_blank" rel="noreferrer noopener">
                <ExternalLink />
                Ver o site
              </a>
            </Button>
          </div>
          {tela?.sub ? (
            <p className="max-w-[70ch] px-3.5 pb-3 text-sm text-muted sm:px-6 lg:px-8">{tela.sub}</p>
          ) : null}
        </header>

        {/* `mx-0`/`rounded-none` anulam a margem negativa e o raio padrão do
            PageBackdrop: aqui ele é a página inteira, não um recorte, e a
            margem negativa abriria rolagem horizontal no celular. */}
        <PageBackdrop
          as="main"
          className="mx-0 min-w-0 flex-1 rounded-none px-3.5 py-5 sm:mx-0 sm:px-6 lg:px-8 lg:py-7"
        >
          {children}
        </PageBackdrop>
      </div>
    </div>
  );
}

/** Atalho para navegar de dentro de uma tela (cartão clicável, por exemplo). */
export { irPara };
