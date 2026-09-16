import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Paginação.
 *
 * Alvos de 48px no celular (40px no desktop). No celular só ficam
 * "anterior", o contador e "próxima": sete botões de 48px não cabem em
 * 390px. O contador é `aria-live` para o leitor de tela ouvir a troca.
 */

function janela(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set<number>([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((p) => set.add(p));
  const nums = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  nums.forEach((p, i) => {
    const prev = nums[i - 1];
    if (i > 0 && prev !== undefined && p - prev > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

const alvo =
  'inline-flex min-h-12 min-w-12 items-center justify-center rounded-sm border px-2 text-sm font-semibold ' +
  'transition-colors select-none md:min-h-10 md:min-w-10 disabled:cursor-not-allowed disabled:opacity-40';

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  label = 'Paginação',
  className,
}: {
  page: number;
  /** Total de itens (não de páginas). */
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  label?: string;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (pages <= 1) return null;
  const atual = Math.min(Math.max(1, page), pages);

  return (
    <nav aria-label={label} className={cn('mt-4 flex flex-wrap items-center justify-between gap-3', className)}>
      <button
        type="button"
        className={cn(alvo, 'border-line-strong text-ink hover:border-accent hover:text-accent')}
        disabled={atual <= 1}
        onClick={() => onChange(atual - 1)}
      >
        <ChevronLeft className="size-4" aria-hidden />
        <span className="sr-only">Página anterior</span>
      </button>

      <p className="text-xs text-muted tabular sm:hidden" aria-live="polite">
        Página {atual} de {pages}
      </p>

      <ul className="hidden items-center gap-1 sm:flex">
        {janela(atual, pages).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} className="px-1 text-muted" aria-hidden>
              …
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                aria-current={p === atual ? 'page' : undefined}
                aria-label={`Página ${p}`}
                onClick={() => onChange(p)}
                className={cn(
                  alvo,
                  'tabular',
                  p === atual
                    ? 'border-accent bg-accent text-accent-ink inset-shadow-hi'
                    : 'border-line text-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {p}
              </button>
            </li>
          ),
        )}
      </ul>

      <button
        type="button"
        className={cn(alvo, 'border-line-strong text-ink hover:border-accent hover:text-accent')}
        disabled={atual >= pages}
        onClick={() => onChange(atual + 1)}
      >
        <ChevronRight className="size-4" aria-hidden />
        <span className="sr-only">Próxima página</span>
      </button>
    </nav>
  );
}
