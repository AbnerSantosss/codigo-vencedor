import { cn } from '@/lib/cn';
import { StatCard } from './stat-card';

/* ------------------------------------------------------------------ *
 * Seletor de período
 * ------------------------------------------------------------------ */

// A implementação vive em `segmented.tsx` (polegar que desliza, teclado);
// a assinatura `{ value, options, onChange, label }` continua a mesma.
export { Segmented, type SegmentedOption } from './segmented';

/* ------------------------------------------------------------------ *
 * Indicador
 * ------------------------------------------------------------------ */

export interface KpiProps {
  label: string;
  value: string;
  /** Variação: positivo sobe verde, negativo desce vermelho, 0 fica neutro. */
  delta?: number | null;
  deltaText?: string;
  note?: string;
  href?: string;
  tom?: 'normal' | 'accent';
}

/** Alias fino de `StatCard` — `tom` vira `tone`; o resto passa direto. */
export function Kpi({ tom = 'normal', ...rest }: KpiProps) {
  return <StatCard {...rest} tone={tom === 'accent' ? 'accent' : 'neutral'} />;
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] sm:gap-4">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Funil
 * ------------------------------------------------------------------ */

export interface FunnelStep {
  label: string;
  value: number;
  /** 0 a 100. */
  pct: number;
  hint?: string;
}

/**
 * Funil em barras.
 *
 * A largura da barra é a única coisa aqui escrita em runtime, e vai pela prop
 * `style` do React — que atribui em `element.style` (CSSOM). A CSP do painel
 * é `style-src 'self'` sem `unsafe-inline`: um `setAttribute('style', …)`
 * seria bloqueado, uma atribuição via CSSOM não.
 *
 * No celular o rótulo vai para cima da barra e ela recebe a largura inteira —
 * no painel antigo o rótulo de largura fixa comia 248px de um cartão de 272px
 * e o gráfico virava um traço.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  return (
    <div className="grid gap-3.5">
      {steps.map((s, i) => {
        const final = i === steps.length - 1;
        return (
          <div
            key={s.label}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 gap-y-1 sm:flex sm:items-center sm:gap-3"
          >
            <div className={cn('min-w-0 text-xs sm:flex-[0_1_10.5rem]', final && 'font-bold')}>
              {s.label}
              {s.hint ? <span className="ml-1.5 text-muted">{s.hint}</span> : null}
            </div>
            <div className="col-span-2 h-4 min-w-0 overflow-hidden rounded-[4px] bg-surface-2 sm:order-2 sm:col-span-1 sm:flex-1">
              <span
                className={cn('block h-full rounded-[4px]', final ? 'bg-accent' : 'bg-info')}
                style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
              />
            </div>
            <div
              className={cn(
                'text-xs font-bold tabular sm:order-3 sm:flex-[0_0_3.5rem] sm:text-right',
                final && 'text-accent',
              )}
            >
              {s.value.toLocaleString('pt-BR')}
            </div>
          </div>
        );
      })}
    </div>
  );
}
