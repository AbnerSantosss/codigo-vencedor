import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Botão do painel.
 *
 * `min-h-11` (44px) no desktop e `min-h-12` (48px) no celular não é estética:
 * é o piso de alvo de toque que o dono cobrou depois de errar botões no
 * iPhone. O público do produto é 90%+ celular e o painel é usado no celular
 * também.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-sm font-bold whitespace-nowrap ' +
    'text-sm select-none transition-colors ' +
    'disabled:opacity-50 disabled:cursor-not-allowed ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent-hover active:translate-y-px',
        ghost:
          'border border-line-strong bg-transparent font-semibold text-ink ' +
          'hover:border-accent hover:bg-surface-2 hover:text-accent',
        danger:
          'border border-danger/45 bg-transparent font-semibold text-danger ' +
          'hover:border-danger hover:bg-danger-soft',
        subtle: 'bg-surface-2 font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink',
        link: 'h-auto min-h-0 p-0 font-semibold text-accent underline decoration-1 underline-offset-4 hover:text-accent-hover',
      },
      size: {
        md: 'min-h-12 px-5 py-2 md:min-h-11',
        sm: 'min-h-10 px-3 text-xs md:min-h-9',
        icon: 'size-11 p-0 md:size-10',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Mostra o giro e bloqueia o clique — sem trocar a largura do botão. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild, loading, children, disabled, type, ...props },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size, block }), className);

  /**
   * `asChild` passa exatamente um filho — e nada mais.
   *
   * O `Slot` do Radix clona o único elemento filho para receber as props do
   * botão. Acrescentar o ícone de carregando aqui daria DOIS filhos e o Slot
   * lança "Expected a single React element child", que em produção derruba a
   * árvore inteira: foi o que deixou o painel em branco no primeiro teste,
   * porque o rodapé da barra lateral usa `asChild` para virar link.
   *
   * Um link também não tem estado de carregando, então nada se perde.
   */
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      // Botão dentro de <form> sem type explícito é `submit` e envia o
      // formulário sem querer. Aqui o padrão é `button`.
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export { buttonVariants };
