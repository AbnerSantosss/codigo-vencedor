import { cn } from '@/lib/cn';

/**
 * Fundo de página: grade fina + ruído (SVG `feTurbulence` em data: URI, que
 * o `img-src 'self' data:` da CSP permite) + dois halos (`halo-1` dourado,
 * `halo-2` azul frio). Tudo em `::before` no CSS (`.cv-backdrop`), sem JS e
 * sem movimento — é um pano de fundo, não um efeito.
 *
 * `isolation: isolate` cria o contexto de empilhamento para o `z-index: -1`
 * do pseudo-elemento ficar atrás do conteúdo e nunca atrás da página.
 */
export function PageBackdrop({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'main';
}) {
  return <Tag className={cn('cv-backdrop -mx-2 rounded-lg px-2 sm:-mx-3 sm:px-3', className)}>{children}</Tag>;
}
