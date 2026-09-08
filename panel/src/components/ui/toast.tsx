import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Avisos de "salvo" e "deu erro".
 *
 * Sobre o Radix Toast por causa do que ele resolve sozinho: o aviso é
 * anunciado por leitor de tela (`role=status` em região viva), pausa o
 * cronômetro quando o ponteiro está em cima, e some sem deixar nó órfão no
 * DOM. O painel antigo removia o elemento por `setTimeout` e, em salvamentos
 * seguidos, dois avisos brigavam pelo mesmo canto.
 */

interface Aviso {
  id: number;
  texto: string;
  erro: boolean;
}

interface ToastApi {
  ok: (texto: string) => void;
  erro: (texto: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToast precisa do ToastProvider');
  return api;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const empilhar = useCallback((texto: string, erro: boolean) => {
    const id = Date.now() + Math.random();
    setAvisos((atual) => [...atual.slice(-2), { id, texto, erro }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      ok: (texto) => empilhar(texto, false),
      erro: (texto) => empilhar(texto, true),
    }),
    [empilhar],
  );

  return (
    <Ctx.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {avisos.map((a) => (
          <ToastPrimitive.Root
            key={a.id}
            onOpenChange={(aberto) => {
              if (!aberto) setAvisos((atual) => atual.filter((x) => x.id !== a.id));
            }}
            className={cn(
              'flex items-start gap-2.5 rounded-sm border border-line-strong border-l-[3px] bg-surface-3 p-3 pr-4 text-sm shadow-float',
              '[animation:ad-slide-up_.16s_ease-out]',
              a.erro ? 'border-l-danger' : 'border-l-ok',
            )}
          >
            {a.erro ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            )}
            <ToastPrimitive.Description className="min-w-0 break-words">{a.texto}</ToastPrimitive.Description>
          </ToastPrimitive.Root>
        ))}
        {/* No celular a pilha fica no rodapé, acima da área do gesto. */}
        <ToastPrimitive.Viewport
          className={cn(
            'fixed z-100 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none',
            'inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))]',
            'sm:inset-x-auto sm:right-5 sm:bottom-5',
          )}
        />
      </ToastPrimitive.Provider>
    </Ctx.Provider>
  );
}
