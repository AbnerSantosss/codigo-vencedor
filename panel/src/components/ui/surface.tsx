import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Superfície — o "cartão" base do painel, com profundidade.
 *
 * Gradiente de 145° (surface → surface-2), borda `line` de 1px e uma linha
 * de luz interna no topo (`inset-shadow-hi`): é o que separa o cartão do
 * fundo sem mudar a paleta. O holofote (`spotlight`) segue o ponteiro só em
 * dispositivos com `(hover: hover)` — a posição vai por CSSOM
 * (`el.style.setProperty`), o que a CSP `style-src 'self' 'nonce'` permite;
 * um `setAttribute('style')` seria bloqueado.
 */

export type SurfaceTone = 'base' | 'elevated' | 'stat' | 'timeline';

const tones: Record<SurfaceTone, string> = {
  base: 'rounded-lg border border-line bg-gradient-surface p-4.5 shadow-card inset-shadow-hi sm:p-6',
  elevated:
    'rounded-lg border border-line-strong bg-gradient-surface p-4.5 shadow-float inset-shadow-hi sm:p-6',
  stat: 'rounded-lg border border-line bg-gradient-surface p-4 shadow-card inset-shadow-hi sm:p-5',
  timeline:
    'rounded-lg border border-line bg-surface p-4 shadow-card inset-shadow-hi sm:p-5',
};

export interface SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  tone?: SurfaceTone;
  /**
   * Holofote que acompanha o ponteiro. `true` usa `accent-soft`; uma string
   * é qualquer expressão de cor em CSS (ex.: `var(--color-info-soft)`).
   */
  spotlight?: boolean | string;
  as?: 'section' | 'div' | 'article' | 'aside' | 'a';
  /** Só faz sentido com `as="a"`. */
  href?: string;
}

function moveSpot(e: React.PointerEvent<HTMLElement>) {
  // Dedo e caneta não têm hover; o holofote ficaria "preso" no último toque.
  if (e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
  el.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
}

export const Surface = forwardRef<HTMLElement, SurfaceProps>(function Surface(
  { tone = 'base', spotlight, as = 'div', className, style, children, onPointerMove, ...props },
  ref,
) {
  const Tag = as;
  const spot = Boolean(spotlight);
  const spotStyle =
    typeof spotlight === 'string' ? ({ ...style, '--spot-color': spotlight } as React.CSSProperties) : style;
  return (
    <Tag
      // A união de refs dos quatro elementos não fecha com o forwardRef
      // genérico; o consumidor recebe `HTMLElement`, que basta para medir.
      ref={ref as React.Ref<never>}
      className={cn('cv-surface min-w-0', tones[tone], spot && 'cv-spot', className)}
      style={spotStyle}
      onPointerMove={
        spot
          ? (e: React.PointerEvent<HTMLElement>) => {
              moveSpot(e);
              onPointerMove?.(e);
            }
          : onPointerMove
      }
      {...props}
    >
      {children}
    </Tag>
  );
});

/**
 * Cabeçalho de superfície — mesma assinatura do `CardTitle` (title, hint,
 * action), com `eyebrow` e `icon` opcionais.
 */
export function SurfaceHeader({
  title,
  hint,
  action,
  eyebrow,
  icon,
  className,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', !hint && 'mb-4', className)}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent inset-shadow-hi [&_svg]:size-4"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 text-2xs font-bold tracking-wider text-accent uppercase">{eyebrow}</p>
          ) : null}
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          {hint ? <p className="mt-1 max-w-[60ch] text-sm text-muted">{hint}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}
