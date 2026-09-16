import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

/**
 * Abas — usadas onde uma tela tem mais de um assunto (E-mail: provedor,
 * templates, automação, histórico). O painel antigo empilhava tudo numa
 * página de 1.500px de rolagem no celular.
 *
 * A faixa rola na horizontal em vez de embrulhar: com 4-5 abas, embrulhar
 * produzia duas linhas e empurrava o conteúdo para baixo da dobra.
 *
 * Indicador que desliza: um `<span>` absoluto dentro da lista recebe
 * `width`/`transform` medidos da aba ativa (`offsetLeft`/`offsetWidth`) por
 * CSSOM; a transição fica no CSS (`.cv-tabs-indicator`). Um MutationObserver
 * em `data-state` acompanha a troca de aba e um ResizeObserver acompanha
 * fontes/largura. Sem motion/framer, sem `layoutId`.
 *
 * Variantes da lista: `segment` (o visual de sempre, padrão), `pill`
 * (sem borda, polegar arredondado) e `underline` (linha dourada embaixo).
 */

export type TabsVariant = 'segment' | 'pill' | 'underline';

const VariantContext = createContext<TabsVariant>('segment');

export const Tabs = TabsPrimitive.Root;

const listVariants: Record<TabsVariant, string> = {
  segment: 'gap-1 rounded-md border border-line bg-surface p-1 inset-shadow-hi',
  pill: 'gap-1 p-1',
  underline: 'gap-2 border-b border-line',
};

export function TabsList({
  children,
  className,
  variant = 'segment',
}: {
  children: React.ReactNode;
  className?: string;
  variant?: TabsVariant;
}) {
  const lista = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const list = lista.current;
    const bar = barra.current;
    if (!list || !bar) return;

    const medir = () => {
      const ativa = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!ativa) {
        bar.style.opacity = '0';
        return;
      }
      bar.style.opacity = '1';
      bar.style.width = `${ativa.offsetWidth}px`;
      bar.style.transform = `translateX(${ativa.offsetLeft}px)`;
    };
    medir();

    const mo = new MutationObserver(medir);
    mo.observe(list, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    const ro = new ResizeObserver(medir);
    ro.observe(list);
    list.querySelectorAll<HTMLElement>('[role="tab"]').forEach((t) => ro.observe(t));
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, []);

  return (
    <VariantContext.Provider value={variant}>
      <TabsPrimitive.List
        ref={lista}
        data-variant={variant}
        className={cn('cv-tabs-list mb-5 flex overflow-x-auto scrollbar-none', listVariants[variant], className)}
      >
        <span ref={barra} className="cv-tabs-indicator" aria-hidden />
        {children}
      </TabsPrimitive.List>
    </VariantContext.Provider>
  );
}

const triggerVariants: Record<TabsVariant, string> = {
  segment:
    'rounded-sm data-[state=inactive]:hover:bg-surface-2 hover:text-ink ' +
    'data-[state=active]:font-bold data-[state=active]:text-accent-ink',
  pill: 'rounded-full hover:text-ink data-[state=active]:font-bold data-[state=active]:text-accent-ink',
  underline:
    'rounded-sm px-2 hover:text-ink data-[state=active]:font-bold data-[state=active]:text-accent',
};

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const variant = useContext(VariantContext);
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'relative z-[1] min-h-12 shrink-0 px-3.5 text-sm font-semibold whitespace-nowrap text-muted transition-colors md:min-h-10',
        triggerVariants[variant],
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="focus-visible:outline-none">
      {children}
    </TabsPrimitive.Content>
  );
}
