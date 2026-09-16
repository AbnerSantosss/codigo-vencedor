import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { num } from '@/lib/format';
import type { ClickCount, ClicksSummary } from '@/lib/types';
import { Kpi, KpiGrid, Segmented } from '@/components/ui/metrics';
import { Empty, ErrorState, Loading } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/ui/table';
import { chaves } from '../hooks';

/* ==========================================================================
   Cliques

   A pergunta que esta tela responde é "onde foi que o lead clicou".

   A tela de Eventos já mostrava que houve clique; o que ela não mostrava era
   *em quê*. Aqui os mesmos eventos aparecem agrupados por botão, por seção da
   página e por rota — as três formas de olhar que levam a decisões
   diferentes: o botão diz qual texto funciona, a seção diz até onde a pessoa
   desce antes de agir, e a rota diz se a landing é a única página que vende.

   Duas colunas em toda tabela, sempre:

   - **Cliques** são disparos.
   - **Pessoas** são quem clicou (sessão, ou visitante, ou a própria linha
     quando não há nenhum dos dois).

   Ler só a primeira engana. Muitos cliques e poucas pessoas é o desenho de um
   botão que não responde — alguém batendo de novo porque nada aconteceu — e
   não o de um botão popular.
   ========================================================================== */

const PERIODOS = [
  { value: 1, label: '24 h' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

/** Quantos cliques cada pessoa deu, em média. Acima de ~2 é sinal de atrito. */
function porPessoa(c: ClickCount): string {
  if (!c.pessoas) return '—';
  return (c.cliques / c.pessoas).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/**
 * Uma tabela de "coisa clicada → cliques / pessoas".
 *
 * As três seções da tela têm a mesma forma; o que muda é o cabeçalho da
 * primeira coluna e o que vai dentro dela.
 */
function TabelaDeCliques<T>({
  titulo,
  hint,
  coluna,
  itens,
  vazio,
  chave,
  celula,
  contagem,
}: {
  titulo: string;
  hint: string;
  coluna: string;
  itens: T[];
  vazio: string;
  chave: (i: T) => string;
  celula: (i: T) => React.ReactNode;
  contagem: (i: T) => ClickCount;
}) {
  return (
    <Surface as="section" className="mb-5">
      <SurfaceHeader title={titulo} hint={hint} />
      {itens.length === 0 ? (
        <Empty>{vazio}</Empty>
      ) : (
        <Table sticky stackBelow="sm" caption={titulo}>
          <THead>
            <TRow>
              <TH>{coluna}</TH>
              <TH num>Cliques</TH>
              <TH num>Pessoas</TH>
              <TH num>Por pessoa</TH>
            </TRow>
          </THead>
          <TBody>
            {itens.map((i) => {
              const c = contagem(i);
              return (
                <TRow key={chave(i)}>
                  <TD label={coluna}>{celula(i)}</TD>
                  <TD num label="Cliques">
                    {num(c.cliques)}
                  </TD>
                  <TD num muted label="Pessoas">
                    {num(c.pessoas)}
                  </TD>
                  <TD num muted label="Por pessoa">
                    {porPessoa(c)}
                  </TD>
                </TRow>
              );
            })}
          </TBody>
        </Table>
      )}
    </Surface>
  );
}

export function TelaCliques() {
  const [dias, setDias] = useState(7);

  const resumo = useQuery({
    queryKey: chaves.clicks(dias),
    queryFn: () => api<ClicksSummary>(`/events/clicks?days=${dias}`),
  });

  if (resumo.isPending) return <Loading />;
  if (resumo.error) {
    if (ehSessaoExpirada(resumo.error)) return null;
    return <ErrorState message={descreverErro(resumo.error)} onRetry={() => void resumo.refetch()} />;
  }

  const d = resumo.data;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end gap-3 sm:justify-end">
        <Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período" />
      </div>

      <KpiGrid>
        <Kpi label="Cliques" value={num(d.total.cliques)} note="Disparos registrados no período." />
        <Kpi
          label="Pessoas que clicaram"
          value={num(d.total.pessoas)}
          note="Sessões distintas — quem clicou três vezes conta uma."
        />
        <Kpi
          label="Cliques por pessoa"
          value={porPessoa(d.total)}
          note="Bem acima de 1 costuma ser botão que não respondeu de primeira."
        />
      </KpiGrid>

      <TabelaDeCliques
        titulo="Em que botão clicaram"
        hint="Agrupado pela chave do botão. Os CTAs de compra têm chave própria; os demais cliques usam uma chave derivada do próprio texto do botão, então trocar o texto cria uma linha nova — é assim que dá para comparar duas versões de rótulo."
        coluna="Botão"
        itens={d.buttons}
        vazio="Nenhum clique registrado no período."
        chave={(b) => b.cta}
        contagem={(b) => b}
        celula={(b) => (
          <>
            <span className="font-semibold">{b.label ?? b.cta}</span>
            <span className="block text-2xs text-muted">
              <code className="font-mono">{b.cta}</code>
              {b.section ? ` · ${b.section}` : ''}
            </span>
          </>
        )}
      />

      <TabelaDeCliques
        titulo="Em que parte da página"
        hint="A seção onde o clique aconteceu. É o que mostra até onde a pessoa desce antes de agir — e quais blocos ninguém toca."
        coluna="Seção"
        itens={d.sections}
        vazio="Nenhum clique com seção identificada no período."
        chave={(s) => s.section}
        contagem={(s) => s}
        celula={(s) => s.section}
      />

      <TabelaDeCliques
        titulo="Em que página"
        hint="A rota onde o clique aconteceu. Serve para conferir se o rastreamento está de pé fora da landing — obrigado, termos e privacidade também disparam eventos."
        coluna="Página"
        itens={d.pages}
        vazio="Nenhum clique registrado no período."
        chave={(p) => p.page}
        contagem={(p) => p}
        celula={(p) => <code className="font-mono text-xs">{p.page}</code>}
      />
    </>
  );
}
