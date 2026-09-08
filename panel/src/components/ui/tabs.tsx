import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/cn';

/**
 * Abas — usadas onde uma tela tem mais de um assunto (E-mail: provedor,
 * templates, automação, histórico). O painel antigo empilhava tudo numa
 * página de 1.500px de rolagem no celular.
 *
 * A faixa rola na horizontal em vez de embrulhar: com 4-5 abas, embrulhar
 * produzia duas linhas e empurrava o conteúdo para baixo da dobra.
 */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'mb-5 flex gap-1 overflow-x-auto rounded-md border border-line bg-surface p-1 scrollbar-none',
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'min-h-10 shrink-0 rounded-sm px-3.5 text-sm font-semibold whitespace-nowrap text-muted',
        'hover:bg-surface-2 hover:text-ink',
        'data-[state=active]:bg-accent data-[state=active]:font-bold data-[state=active]:text-accent-ink',
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
