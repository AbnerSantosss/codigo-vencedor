import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ExternalLink, LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { irPara } from '@/lib/router';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
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
   ========================================================================== */

function ItemDeMenu({
  tela,
  ativo,
  onNavegar,
}: {
  tela: Tela;
  ativo: boolean;
  onNavegar: () => void;
}) {
  const Icone = tela.icone;
  return (
    <a
      href={`#${tela.id}`}
      aria-current={ativo ? 'page' : undefined}
      onClick={onNavegar}
      className={cn(
        'relative flex min-h-12 items-center gap-2.5 rounded-sm px-3 text-md no-underline lg:min-h-10',
        ativo
          ? 'bg-accent-soft font-semibold text-accent'
          : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        // Barra à esquerda no item ativo: a cor de fundo sozinha é fraca
        // demais para dizer "você está aqui" numa lista de 14 itens.
        ativo &&
          'before:absolute before:inset-y-1.5 before:-left-2 before:w-[3px] before:rounded-r-[3px] before:bg-accent before:content-[""]',
      )}
    >
      <Icone className={cn('size-4.5 shrink-0', ativo ? 'text-accent' : 'text-muted')} aria-hidden />
      <span className="truncate">{tela.label}</span>
    </a>
  );
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
  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Telas do painel">
      {GRUPOS.map((grupo) => {
        const itens = TELAS.filter((t) => t.grupo === grupo && podeVer(t, me?.role));
        if (!itens.length) return null;
        return (
          <div key={grupo} className="contents">
            <div className="px-3 pt-4 pb-1 text-3xs font-bold tracking-widest text-muted uppercase">
              {grupo}
            </div>
            {itens.map((t) => (
              <ItemDeMenu key={t.id} tela={t} ativo={t.id === telaAtual} onNavegar={onNavegar} />
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
      <aside className="sticky top-0 hidden h-svh flex-col gap-2 overflow-y-auto border-r border-line bg-surface py-5 lg:flex">
        <div className="px-5">
          <Marca />
          <p className="mt-1 text-2xs text-muted">Painel administrativo</p>
        </div>
        <MenuTelas telaAtual={telaAtual} me={me} onNavegar={() => undefined} />
        <Rodape me={me} onSair={onSair} />
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* ------------------------------------------ Cabeçalho fixo --- */}
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-3.5 py-3 sm:px-6 lg:px-8">
            {/* Gaveta — só no celular e no tablet. */}
            <DialogPrimitive.Root open={gaveta} onOpenChange={setGaveta}>
              <DialogPrimitive.Trigger
                aria-label="Abrir o menu"
                className="grid size-11 shrink-0 place-items-center rounded-sm border border-line-strong text-ink hover:border-accent hover:text-accent lg:hidden"
              >
                <Menu className="size-5" />
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/65 [animation:ad-fade-in_.15s_ease-out]" />
                <DialogPrimitive.Content
                  aria-label="Menu do painel"
                  className="fixed inset-y-0 left-0 z-50 flex w-[min(17rem,88vw)] flex-col gap-2 overflow-y-auto border-r border-line bg-surface py-5 shadow-float [animation:ad-slide-in-left_.18s_ease-out]"
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
                      className="grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink"
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

        <main className="min-w-0 flex-1 px-3.5 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
      </div>
    </div>
  );
}

/** Atalho para navegar de dentro de uma tela (cartão clicável, por exemplo). */
export { irPara };
