import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Surface } from './surface';

/**
 * Cartão de indicador (KPI).
 *
 * Rótulo em caixa alta, valor grande tabular, ícone num ladrilho à direita e
 * a variação embaixo — o layout do "Stat Card" do 21st adaptado aos tokens
 * do painel. A cor só entra no ladrilho do ícone e na variação: o valor fica
 * em `ink` (ou `accent` quando o cartão é o número principal da tela).
 */

export type StatTone = 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

const iconTones: Record<StatTone, string> = {
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-2 text-muted',
};

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  /** Variação: positivo sobe verde, negativo desce vermelho, 0/null fica neutro. */
  delta?: number | null;
  deltaText?: string;
  note?: string;
  href?: string;
  tone?: StatTone;
  size?: 'md' | 'sm';
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  deltaText,
  note,
  href,
  tone = 'neutral',
  size = 'md',
  className,
}: StatCardProps) {
  const neutro = delta === null || delta === undefined || delta === 0;
  const temDelta = deltaText !== undefined || delta !== undefined;
  const sm = size === 'sm';

  return (
    <Surface
      tone="stat"
      as={href ? 'a' : 'div'}
      href={href}
      spotlight={Boolean(href)}
      className={cn(
        sm && 'p-3 sm:p-4',
        href && 'block text-inherit no-underline transition-colors hover:border-accent',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn('text-2xs font-bold tracking-wider text-muted uppercase', sm ? 'mb-1' : 'mb-2')}>
          {label}
        </div>
        {icon ? (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-md inset-shadow-hi [&_svg]:size-4',
              sm ? 'size-7' : 'size-9',
              iconTones[tone],
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          'leading-tight font-extrabold tracking-tight tabular',
          sm ? 'text-xl' : 'text-2xl',
          tone === 'accent' && 'text-accent',
        )}
      >
        {value}
      </div>
      {temDelta ? (
        <div
          className={cn(
            'mt-2 flex flex-wrap items-center gap-1 text-xs font-semibold',
            neutro ? 'text-muted' : delta > 0 ? 'text-ok' : 'text-danger',
          )}
        >
          {!neutro ? (
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
    </Surface>
  );
}
