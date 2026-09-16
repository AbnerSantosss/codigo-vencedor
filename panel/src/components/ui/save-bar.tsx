import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * Barra de salvar — a única barra "alterações não salvas / Salvar" do painel.
 *
 * Fica presa ao rodapé do cartão/da tela (`sticky bottom-0`), o que no
 * celular significa: o botão de salvar está sempre visível, sem rolar até o
 * fim de um formulário de 1.500px.
 *
 * - `inset` (padrão): as margens negativas encostam a barra nas bordas da
 *   `Surface` (p-4.5 / sm:p-6) que a contém.
 * - `inset={false}`: barra solta, com borda e cantos próprios — para o fim
 *   de uma tela com vários cartões.
 * - `submit`: o botão vira `type="submit"` do `<form>` que envolve a barra,
 *   e o Enter num campo continua enviando o formulário.
 * - `extra`: ações secundárias ao lado do salvar (testar conexão, etc.).
 */
export function SaveBar({
  dirty,
  saving,
  disabled,
  onSave,
  onReset,
  message,
  saveLabel = 'Salvar alterações',
  resetLabel = 'Descartar',
  inset = true,
  submit,
  extra,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  /** Bloqueia o salvar mesmo com alterações (ex.: campos inválidos). */
  disabled?: boolean;
  onSave?: () => void;
  onReset?: () => void;
  /** Texto de estado; sem ele a barra diz se há alterações pendentes. */
  message?: React.ReactNode;
  saveLabel?: string;
  resetLabel?: string;
  inset?: boolean;
  submit?: boolean;
  extra?: React.ReactNode;
  className?: string;
}) {
  const texto = message ?? (dirty ? 'Você tem alterações não salvas.' : 'Tudo salvo.');
  return (
    <div
      role="region"
      aria-label="Salvar alterações"
      className={cn(
        'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3',
        'border-t border-line bg-surface/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm inset-shadow-hi',
        inset
          ? '-mx-4.5 -mb-4.5 mt-6 px-4.5 sm:-mx-6 sm:-mb-6 sm:rounded-b-lg sm:px-6'
          : 'mt-5 rounded-lg border px-4.5 shadow-card sm:px-6',
        className,
      )}
    >
      <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-muted">
        <span
          className={cn('size-2 shrink-0 rounded-full', dirty ? 'bg-warn' : 'bg-ok')}
          aria-hidden
        />
        <span className="min-w-0">{texto}</span>
      </p>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>button]:max-sm:flex-1">
        {extra}
        {onReset ? (
          <Button variant="ghost" onClick={onReset} disabled={!dirty || saving}>
            {resetLabel}
          </Button>
        ) : null}
        <Button
          type={submit ? 'submit' : 'button'}
          onClick={submit ? undefined : onSave}
          loading={saving}
          disabled={!dirty || disabled}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
