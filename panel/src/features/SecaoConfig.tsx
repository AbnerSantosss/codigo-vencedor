import { descreverErro, ehSessaoExpirada } from '@/lib/api';
import type { ConfigResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Actions, Card, CardTitle, ErrorState, Loading } from '@/components/ui/layout';
import { useConfig } from './hooks';

/**
 * Casca das telas que editam uma seção do `SiteConfig`.
 *
 * A tela recebe a config já carregada — ela não trata "e se ainda não
 * chegou". E uma tela que falha mostra o motivo com "tentar de novo" enquanto
 * o menu continua funcionando: é a regra que consertou o painel preso em
 * "Carregando painel…".
 */
export function ComConfig({ children }: { children: (cfg: ConfigResponse) => React.ReactNode }) {
  const { data, isPending, error, refetch } = useConfig();

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }
  return <>{children(data)}</>;
}

/** Cartão-formulário com o botão de salvar. */
export function CardForm({
  title,
  hint,
  action,
  children,
  onSubmit,
  salvando,
  extra,
  rotuloSalvar = 'Salvar',
  wide,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  onSubmit: () => void;
  salvando?: boolean;
  extra?: React.ReactNode;
  rotuloSalvar?: string;
  wide?: boolean;
}) {
  return (
    <Card wide={wide}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <CardTitle title={title} hint={hint} action={action} />
        <div className="grid gap-4">{children}</div>
        <Actions>
          <Button type="submit" loading={salvando}>
            {rotuloSalvar}
          </Button>
          {extra}
        </Actions>
      </form>
    </Card>
  );
}
