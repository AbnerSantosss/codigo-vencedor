import { useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Controle segmentado (radiogroup) com o "polegar" dourado que desliza.
 *
 * O polegar é um `<span>` absoluto com `width: 100%/n` e
 * `transform: translateX(i * 100%)` escritos pela prop `style` (CSSOM) —
 * a transição fica no CSS (`.cv-seg-thumb`). Sem motion/framer: uma
 * `transition: transform` faz o mesmo e respeita o `prefers-reduced-motion`
 * global do app.css.
 *
 * Teclado (padrão ARIA de radiogroup): setas movem e selecionam, Home/End
 * vão aos extremos, só o item ativo entra na ordem de Tab.
 */

export interface SegmentedOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  size = 'md',
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: 'md' | 'sm';
}) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const n = options.length;
  const idx = options.findIndex((o) => o.value === value);

  function irPara(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    botoes.current[i]?.focus();
  }

  function proximo(de: number, passo: 1 | -1) {
    for (let k = 1; k <= n; k++) {
      const i = (de + passo * k + n * k) % n;
      if (!options[i]?.disabled) return i;
    }
    return de;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const atual = idx < 0 ? 0 : idx;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        irPara(proximo(atual, 1));
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        irPara(proximo(atual, -1));
        break;
      case 'Home':
        e.preventDefault();
        irPara(proximo(n - 1, 1));
        break;
      case 'End':
        e.preventDefault();
        irPara(proximo(0, -1));
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex max-w-full rounded-md border border-line bg-surface p-1 inset-shadow-hi', className)}
    >
      <div
        className="relative grid min-w-0 flex-1"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {idx >= 0 ? (
          <span
            className="cv-seg-thumb"
            aria-hidden
            style={{ width: `${100 / n}%`, transform: `translateX(${idx * 100}%)` }}
          />
        ) : null}
        {options.map((o, i) => {
          const ativo = i === idx;
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                botoes.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={o.disabled}
              tabIndex={ativo || (idx < 0 && i === 0) ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                'relative z-[1] min-w-0 truncate rounded-sm px-3 font-semibold transition-colors select-none',
                size === 'sm' ? 'min-h-10 text-xs md:min-h-9' : 'min-h-12 text-sm md:min-h-10',
                ativo ? 'font-bold text-accent-ink' : 'text-muted hover:text-ink',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
