import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Modal — sobre o Radix Dialog.
 *
 * Radix entrega o que dava trabalho fazer à mão e o painel antigo não tinha:
 * foco preso dentro do modal, `Esc` para fechar, `aria-modal`, e o retorno do
 * foco ao elemento que abriu. As animações vêm do CSS compilado
 * (`styles/app.css`), não de `<style>` injetado — a CSP do /admin não libera
 * `unsafe-inline`.
 *
 * No celular ele sobe do rodapé e ocupa a largura inteira; no desktop, centro
 * da tela com largura de leitura.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/65 [animation:ad-fade-in_.15s_ease-out] backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col border border-line-strong bg-surface shadow-float',
          // Celular: folha que sobe do rodapé, com respiro para o notch.
          'inset-x-0 bottom-0 max-h-[92svh] rounded-t-lg pb-[env(safe-area-inset-bottom)]',
          // Desktop: caixa central.
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85svh] sm:w-[min(40rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:pb-0',
          'sm:[animation:ad-zoom-in_.16s_ease-out]',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-lg font-bold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="grid size-10 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="size-4.5" />
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Rodapé de ações do modal — cola no fim no celular. */
export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4 [&>button]:max-sm:flex-1">
      {children}
    </div>
  );
}
