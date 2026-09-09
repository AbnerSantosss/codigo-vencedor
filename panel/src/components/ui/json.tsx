import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { useToast } from './toast';

/* ==========================================================================
   Bloco de JSON

   O painel não tinha nenhum jeito de mostrar um objeto cru, e a tela de
   Eventos precisa mostrar o corpo exato que sai no webhook — não uma versão
   resumida dele. Como o mesmo bloco vai reaparecer em outras telas, ele mora
   aqui e não dentro de `Eventos.tsx`.

   Duas decisões de layout que existem por causa do celular:

   • `whitespace-pre-wrap` + quebra em qualquer ponto. Um `<pre>` normal tem
     largura mínima igual à sua linha mais longa — um payload com uma URL de
     200 caracteres esticaria a tabela e, com ela, a página inteira para o
     lado. Quebrando, o bloco encolhe até caber em 390px.
   • `overflow-auto` + teto de altura: mesmo quebrando, um payload grande
     rolaria a página por dezenas de telas. A rolagem fica dentro do bloco.

   E uma de segurança: nada de destacar sintaxe injetando HTML. O conteúdo
   entra como texto (`{texto}`), que o React escapa — payload é dado de
   visitante, não markup confiável.
   ========================================================================== */

function formatar(value: unknown): string {
  try {
    // `JSON.stringify` devolve `undefined` para `undefined` e para função —
    // o `??` evita renderizar a string vazia como se fosse um payload vazio.
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    /* Ciclo ou BigInt no objeto: um aviso legível é melhor do que a exceção
       derrubando a árvore de React no meio do render. */
    return '/* não foi possível formatar este conteúdo como JSON */';
  }
}

export interface JsonBlockProps {
  value: unknown;
  /** Nome da região rolável, anunciado por leitor de tela. */
  label?: string;
  /** Quando presente, desenha o botão de copiar com este rótulo. */
  copyLabel?: string;
  /** Texto do aviso de sucesso ao copiar. */
  copyMessage?: string;
  className?: string;
}

export function JsonBlock({
  value,
  label = 'Conteúdo em JSON',
  copyLabel,
  copyMessage = 'Copiado',
  className,
}: JsonBlockProps) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const relogio = useRef<number | null>(null);
  const texto = formatar(value);

  useEffect(() => () => {
    if (relogio.current !== null) window.clearTimeout(relogio.current);
  }, []);

  function copiar(): void {
    /* `navigator.clipboard` não existe fora de contexto seguro — e o dono
       abre o painel pelo IP da rede local no celular, que é http://. Ler a
       promessa antes de encadear evita o TypeError e deixa a falha virar um
       aviso ("copie à mão") em vez de um clique que não faz nada. */
    const escrita = navigator.clipboard?.writeText(texto);
    if (!escrita) {
      toast.erro('Este navegador não deixa copiar daqui — selecione o texto e copie à mão.');
      return;
    }
    void escrita
      .then(() => {
        setCopiado(true);
        toast.ok(copyMessage);
        relogio.current = window.setTimeout(() => setCopiado(false), 1600);
      })
      .catch(() => toast.erro('Não foi possível copiar — selecione o texto e copie à mão.'));
  }

  return (
    <div className="min-w-0">
      {copyLabel ? (
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={copiar} aria-label={copyLabel}>
            {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copiado ? 'Copiado' : copyLabel}
          </Button>
        </div>
      ) : null}
      <pre
        // Região rolável precisa ser alcançável pelo teclado, senão quem não
        // usa mouse não chega no fim de um payload longo.
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          'max-h-[22rem] min-w-0 overflow-auto rounded-sm border border-line bg-bg p-3',
          'font-mono text-2xs leading-relaxed whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          className,
        )}
      >
        {texto}
      </pre>
    </div>
  );
}
