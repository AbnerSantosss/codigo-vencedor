import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ *
 * Seletor de período
 * ------------------------------------------------------------------ */

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-0.5 rounded-md border border-line bg-surface p-1"
    >
      {options.map((o) => {
        const ativo = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-10 rounded-sm px-3.5 text-sm font-semibold md:min-h-9',
              ativo ? 'bg-accent font-bold text-accent-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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

export function Kpi({ label, value, delta, deltaText, note, href, tom = 'normal' }: KpiProps) {
  const corpo = (
    <div
      className={cn(
        'min-w-0 rounded-lg border border-line bg-surface p-4 shadow-card sm:p-5',
        href && 'transition-colors hover:border-accent hover:bg-surface-2',
      )}
    >
      <div className="mb-2 text-2xs font-bold tracking-wider text-muted uppercase">{label}</div>
      <div
        className={cn(
          'text-2xl leading-tight font-extrabold tracking-tight tabular',
          tom === 'accent' && 'text-accent',
        )}
      >
        {value}
      </div>
      {deltaText || delta !== undefined ? (
        <div
          className={cn(
            'mt-2 flex flex-wrap items-center gap-1 text-xs font-semibold',
            delta === null || delta === undefined || delta === 0
              ? 'text-muted'
              : delta > 0
                ? 'text-ok'
                : 'text-danger',
          )}
        >
          {delta !== null && delta !== undefined && delta !== 0 ? (
            delta > 0 ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            )
          ) : null}
          {deltaText ? <span>{deltaText}</span> : null}
          {note ? <span className="font-normal text-muted">{note}</span> : null}
        </div>
      ) : note ? (
        <div className="mt-2 text-xs text-muted">{note}</div>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block text-inherit no-underline">
        {corpo}
      </a>
    );
  }
  return corpo;
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
