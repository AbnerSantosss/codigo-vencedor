import { cn } from '@/lib/cn';

/**
 * Tabela do painel (segunda geração).
 *
 * - O invólucro rola na horizontal; a página nunca (armadilha 90).
 * - `sticky`: o cabeçalho fica preso no topo enquanto o corpo rola dentro
 *   de um teto de 70vh (`.cv-table-sticky`).
 * - `stackBelow="sm"`: abaixo de 640px cada linha vira um cartão e cada
 *   célula mostra o rótulo da coluna (`data-label`) — CSS em app.css,
 *   `.cv-table-stack`. Para isso, cada `TD` precisa do `label`.
 * - Células numéricas: `num` alinha à direita e liga `.tabular`.
 *
 * A `Table`/`Th`/`Td` de `layout.tsx` continua existindo para as telas que
 * já a usam; esta é a que as telas novas devem adotar.
 */

export function Table({
  children,
  className,
  wrapClassName,
  sticky,
  stackBelow,
  caption,
}: {
  children: React.ReactNode;
  className?: string;
  wrapClassName?: string;
  sticky?: boolean;
  stackBelow?: 'sm';
  /** Legenda para leitores de tela (visualmente oculta). */
  caption?: string;
}) {
  return (
    <div
      className={cn(
        '-mx-1 overflow-x-auto px-1',
        sticky && 'max-h-[70vh] overflow-y-auto overscroll-contain',
        wrapClassName,
      )}
    >
      <table
        className={cn(
          'w-full border-collapse text-sm',
          sticky && 'cv-table-sticky',
          stackBelow === 'sm' && 'cv-table-stack',
          className,
        )}
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <thead className={className}>{children}</thead>;
}

export function TBody({
  children,
  className,
  zebra = true,
}: {
  children: React.ReactNode;
  className?: string;
  zebra?: boolean;
}) {
  return (
    <tbody className={cn(zebra && '[&>tr:nth-child(even)]:bg-surface-2/40', className)}>{children}</tbody>
  );
}

export function TRow({
  children,
  className,
  selected,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      className={cn(
        'transition-colors hover:bg-surface-2/70',
        selected && 'bg-accent-soft hover:bg-accent-soft',
        props.onClick && 'cursor-pointer',
        className,
      )}
      aria-selected={selected || undefined}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  className,
  num,
}: {
  children?: React.ReactNode;
  className?: string;
  num?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line px-2 py-2.5 text-left text-2xs font-bold tracking-wider whitespace-nowrap text-muted uppercase',
        num && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  num,
  muted,
  label,
}: {
  children?: React.ReactNode;
  className?: string;
  num?: boolean;
  muted?: boolean;
  /** Rótulo da coluna, mostrado no modo empilhado do celular. */
  label?: string;
}) {
  return (
    <td
      data-label={label}
      data-num={num ? 'true' : undefined}
      className={cn(
        'max-w-[12rem] overflow-hidden border-b border-line px-2 py-2.5 text-ellipsis whitespace-nowrap sm:max-w-[18rem]',
        num && 'text-right tabular',
        muted && 'text-muted',
        className,
      )}
    >
      {children}
    </td>
  );
}
