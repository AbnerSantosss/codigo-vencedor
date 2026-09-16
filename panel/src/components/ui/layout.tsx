import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Surface } from './surface';

/* ------------------------------------------------------------------ *
 * Cartão
 * ------------------------------------------------------------------ */

/**
 * `Card` é um invólucro fino sobre `Surface tone="base"`: mesma assinatura
 * de sempre (className, children, wide), visual novo (gradiente + linha de
 * luz). As 17 telas continuam funcionando sem mudar uma linha.
 */
export function Card({
  className,
  children,
  wide,
}: {
  className?: string;
  children: React.ReactNode;
  /** Sem o teto de leitura de ~52rem — para tabelas e gráficos. */
  wide?: boolean;
}) {
  return (
    <Surface
      as="section"
      tone="base"
      className={cn(
        // `min-w-0` (já em Surface) não é enfeite: dentro de uma grade, um
        // item tem `min-width: auto` e cresce até caber o conteúdo mais
        // largo. Uma tabela com `white-space: nowrap` dentro do cartão
        // empurrava o cartão para 496px numa tela de 390px, e a PÁGINA
        // inteira rolava para o lado — o defeito que o dono chamava de
        // "elementos ultrapassando a tela". Com `min-w-0` o cartão encolhe
        // e quem rola é a tabela, dentro do próprio invólucro.
        'mb-5',
        wide ? 'max-w-none' : 'max-w-[52rem]',
        className,
      )}
    >
      {children}
    </Surface>
  );
}

export function CardTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', !hint && 'mb-4')}>
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 max-w-[60ch] text-sm text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** Título de grupo dentro de um cartão. */
export function GroupTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('mb-3 text-xs font-bold tracking-wide text-accent uppercase', className)}>{children}</h3>
  );
}

export function Actions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mt-6 flex flex-wrap items-center gap-3 [&>button]:max-sm:flex-1', className)}>
      {children}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('my-6 border-0 border-t border-line', className)} />;
}

/* ------------------------------------------------------------------ *
 * Avisos
 * ------------------------------------------------------------------ */

const tons = {
  ok: { cls: 'bg-ok-soft border-ok/30 border-l-ok text-ok', Icon: CheckCircle2 },
  err: { cls: 'bg-danger-soft border-danger/32 border-l-danger text-danger', Icon: XCircle },
  warn: { cls: 'bg-warn-soft border-warn/30 border-l-warn text-warn', Icon: AlertTriangle },
  info: { cls: 'bg-info-soft border-info/30 border-l-info text-info', Icon: Info },
} as const;

export type Tom = keyof typeof tons;

export function Callout({
  tom = 'info',
  children,
  className,
}: {
  tom?: Tom;
  children: React.ReactNode;
  className?: string;
}) {
  const { cls, Icon } = tons[tom];
  return (
    <div
      role={tom === 'err' ? 'alert' : 'status'}
      className={cn('mb-4 flex gap-2.5 rounded-sm border border-l-[3px] p-3 text-sm inset-shadow-hi', cls, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 [&_strong]:font-bold">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Etiqueta de estado
 * ------------------------------------------------------------------ */

const badgeTons = {
  paid: 'bg-ok-soft text-ok',
  pending: 'bg-warn-soft text-warn',
  neutral: 'bg-surface-2 text-muted',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
} as const;

export function Badge({
  tom = 'neutral',
  children,
  className,
}: {
  tom?: keyof typeof badgeTons;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-bold whitespace-nowrap inset-shadow-hi',
        badgeTons[tom],
        className,
      )}
    >
      {/* Ponto antes do texto: quem não distingue as cores continua lendo o
          rótulo, e a etiqueta não comunica estado só por cor. */}
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Estados de tela
 * ------------------------------------------------------------------ */

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/**
 * Falha de uma tela.
 *
 * A casca do painel continua desenhada e o menu utilizável: foi o conserto do
 * "Carregando painel…" eterno do painel antigo, e a regra continua valendo
 * aqui — uma tela que falha mostra o motivo e um "tentar de novo", nunca
 * derruba o painel inteiro.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-danger">
        <XCircle className="size-5" aria-hidden />
        Esta tela não carregou
      </h2>
      <p className="mb-4 max-w-[60ch] text-sm text-ink-2">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-sm border border-line-strong px-4 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
        >
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-surface-2', className)} aria-hidden />;
}

/* ------------------------------------------------------------------ *
 * Tabela
 * ------------------------------------------------------------------ */

/**
 * Tabela com rolagem própria.
 *
 * O `overflow-x-auto` fica no invólucro, e não no `<main>`: sem isso uma
 * tabela larga empurra a página inteira para o lado no celular, que era o
 * "elementos ultrapassando a tela" do painel antigo.
 */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('-mx-1 overflow-x-auto px-1', className)}>{children}</div>;
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>;
}

export function Th({
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
        'border-b border-line px-2 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-muted',
        num && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  num,
  muted,
}: {
  children?: React.ReactNode;
  className?: string;
  num?: boolean;
  muted?: boolean;
}) {
  return (
    <td
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
