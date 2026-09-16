import { useState } from 'react';
import { Activity, CreditCard, Flame, Sparkles, TrendingUp, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Callout, Card, CardTitle, GroupTitle } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { PageBackdrop } from '@/components/ui/backdrop';
import { StatCard, type StatTone } from '@/components/ui/stat-card';
import { Segmented } from '@/components/ui/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger, type TabsVariant } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { SaveBar } from '@/components/ui/save-bar';
import { Kpi, KpiGrid } from '@/components/ui/metrics';
import type { PropsDeTela } from '../registry';

/**
 * Vitrine (dev): todos os primitivos da fundação lado a lado, em todos os
 * estados. Só entra no bundle em desenvolvimento (`import.meta.env.DEV`) —
 * o `registry.tsx` e o `screens.ts` só a registram nesse caso, e o Rollup
 * descarta o módulo. Se "Vitrine" aparecer em `panel/dist`, algo furou.
 */

const TONS: StatTone[] = ['accent', 'ok', 'warn', 'danger', 'info', 'neutral'];
const PERIODOS = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
] as const;
const PERIODOS_COM_ANO: { value: 7 | 30 | 90; label: string; disabled?: boolean }[] = [
  ...PERIODOS,
  { value: 90, label: 'Ano (desabilitado)', disabled: true },
];
const ABAS: TabsVariant[] = ['segment', 'pill', 'underline'];
const LINHAS = Array.from({ length: 6 }, (_, i) => ({
  id: `PIX-${1040 + i}`,
  nome: ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Rocha', 'Elisa Prado', 'Fábio Neri'][i] ?? '',
  origem: ['instagram', 'facebook', 'direto', 'youtube', 'instagram', 'facebook'][i] ?? '',
  valor: 2790 * (i + 1),
  estado: (['paid', 'pending', 'paid', 'danger', 'paid', 'pending'] as const)[i] ?? 'paid',
}));

function brl(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function TelaVitrine(_props: PropsDeTela) {
  const [periodo, setPeriodo] = useState<7 | 30 | 90>(30);
  const [pagina, setPagina] = useState(3);
  const [sujo, setSujo] = useState(true);
  const [salvando, setSalvando] = useState(false);

  function salvar() {
    setSalvando(true);
    window.setTimeout(() => {
      setSalvando(false);
      setSujo(false);
    }, 1200);
  }

  return (
    <PageBackdrop>
      <Callout tom="warn">
        <strong>Tela de desenvolvimento.</strong> Não existe no build de produção. Serve para ver cada
        primitivo em cada estado — inclusive no celular e com teclado.
      </Callout>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle title="Button" hint="Cinco variantes, três tamanhos, carregando e desabilitado." />
        <GroupTitle>Variantes</GroupTitle>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button>Primário</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
        </div>
        <GroupTitle>Tamanhos</GroupTitle>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button size="md">Médio</Button>
          <Button size="sm">Pequeno</Button>
          <Button size="icon" aria-label="Ícone">
            <Sparkles />
          </Button>
          <Button variant="ghost" size="sm">
            Ghost pequeno
          </Button>
          <Button variant="ghost" size="icon" aria-label="Ícone ghost">
            <Flame />
          </Button>
        </div>
        <GroupTitle>Estados</GroupTitle>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button loading>Salvando…</Button>
          <Button variant="ghost" loading>
            Carregando
          </Button>
          <Button disabled>Desabilitado</Button>
          <Button variant="ghost" disabled>
            Ghost desabilitado
          </Button>
          <Button variant="danger" disabled>
            Danger desabilitado
          </Button>
        </div>
        <GroupTitle>asChild (link) e block</GroupTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost">
            <a href="#dashboard">Ir ao dashboard (asChild)</a>
          </Button>
          <Button block className="sm:max-w-xs">
            Bloco
          </Button>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle title="Surface" hint="Quatro tons, com e sem holofote (só com ponteiro de mouse)." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Surface tone="base">
            <SurfaceHeader eyebrow="base" title="Base" hint="O Card de sempre, agora com gradiente." />
            <p className="text-sm text-ink-2">Sem holofote.</p>
          </Surface>
          <Surface tone="base" spotlight>
            <SurfaceHeader eyebrow="base" title="Base + holofote" icon={<Sparkles />} />
            <p className="text-sm text-ink-2">Passe o mouse.</p>
          </Surface>
          <Surface tone="elevated">
            <SurfaceHeader eyebrow="elevated" title="Elevada" hint="Borda forte, sombra flutuante." />
          </Surface>
          <Surface tone="elevated" spotlight="var(--color-info-soft)">
            <SurfaceHeader eyebrow="elevated" title="Elevada + holofote azul" />
            <p className="text-sm text-ink-2">Holofote com cor de token.</p>
          </Surface>
          <Surface tone="stat">
            <SurfaceHeader eyebrow="stat" title="Stat" hint="Preenchimento menor, para KPIs." />
          </Surface>
          <Surface tone="stat" spotlight>
            <SurfaceHeader eyebrow="stat" title="Stat + holofote" />
          </Surface>
          <Surface tone="timeline">
            <SurfaceHeader eyebrow="timeline" title="Timeline" hint="Fio dourado à esquerda." />
          </Surface>
          <Surface tone="timeline" spotlight as="article">
            <SurfaceHeader eyebrow="timeline" title="Timeline + holofote" />
          </Surface>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle title="StatCard" hint="Seis tons × dois tamanhos, com ícone, variação e link." />
        <GroupTitle>md</GroupTitle>
        <KpiGrid>
          {TONS.map((tone, i) => (
            <StatCard
              key={tone}
              tone={tone}
              label={tone}
              value={brl(279000 - i * 31000)}
              icon={[<Wallet key="w" />, <TrendingUp key="t" />, <Activity key="a" />, <Flame key="f" />, <Users key="u" />, <CreditCard key="c" />][i]}
              delta={[12, 4, 0, -8, 2, null][i]}
              deltaText={['+12%', '+4%', '0%', '-8%', '+2%', undefined][i]}
              note="vs. período anterior"
              href={i === 0 ? '#dashboard' : undefined}
            />
          ))}
        </KpiGrid>
        <GroupTitle>sm</GroupTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TONS.map((tone, i) => (
            <StatCard key={tone} tone={tone} size="sm" label={tone} value={String(120 - i * 17)} note="hoje" />
          ))}
        </div>
        <GroupTitle className="mt-5">Kpi (alias legado)</GroupTitle>
        <KpiGrid>
          <Kpi label="Receita" value={brl(1234500)} delta={5} deltaText="+5%" tom="accent" />
          <Kpi label="Pix gerados" value="312" delta={-3} deltaText="-3%" note="7 dias" />
        </KpiGrid>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle
          title="Segmented"
          hint="Radiogroup: setas, Home e End no teclado; polegar desliza em CSS."
          action={<Segmented value={periodo} options={PERIODOS} onChange={setPeriodo} label="Período" />}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Segmented
            value={periodo}
            options={PERIODOS_COM_ANO}
            onChange={setPeriodo}
            label="Período (com item desabilitado)"
            size="sm"
          />
          <span className="text-sm text-muted">Selecionado: {periodo} dias</span>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle title="Tabs" hint="Três variantes da lista; o indicador segue a aba ativa." />
        {ABAS.map((v) => (
          <div key={v} className="mb-6 last:mb-0">
            <GroupTitle>{v}</GroupTitle>
            <Tabs defaultValue="a">
              <TabsList variant={v}>
                <TabsTrigger value="a">Provedor</TabsTrigger>
                <TabsTrigger value="b">Templates</TabsTrigger>
                <TabsTrigger value="c">Automação</TabsTrigger>
                <TabsTrigger value="d">Histórico</TabsTrigger>
              </TabsList>
              <TabsContent value="a">
                <p className="text-sm text-ink-2">Conteúdo da aba Provedor.</p>
              </TabsContent>
              <TabsContent value="b">
                <p className="text-sm text-ink-2">Conteúdo da aba Templates.</p>
              </TabsContent>
              <TabsContent value="c">
                <p className="text-sm text-ink-2">Conteúdo da aba Automação.</p>
              </TabsContent>
              <TabsContent value="d">
                <p className="text-sm text-ink-2">Conteúdo da aba Histórico.</p>
              </TabsContent>
            </Tabs>
          </div>
        ))}
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle
          title="Table + Pagination"
          hint="Cabeçalho fixo, zebra suave, numéricos tabulares; abaixo de 640px cada linha vira um cartão."
        />
        <Table sticky stackBelow="sm" caption="Últimos pagamentos">
          <THead>
            <TRow>
              <TH>Pedido</TH>
              <TH>Cliente</TH>
              <TH>Origem</TH>
              <TH num>Valor</TH>
              <TH>Estado</TH>
            </TRow>
          </THead>
          <TBody>
            {LINHAS.map((l) => (
              <TRow key={l.id}>
                <TD label="Pedido" className="font-mono text-xs">
                  {l.id}
                </TD>
                <TD label="Cliente">{l.nome}</TD>
                <TD label="Origem" muted>
                  {l.origem}
                </TD>
                <TD label="Valor" num>
                  {brl(l.valor)}
                </TD>
                <TD label="Estado">
                  <Badge tom={l.estado}>
                    {l.estado === 'paid' ? 'Pago' : l.estado === 'pending' ? 'Pendente' : 'Falhou'}
                  </Badge>
                </TD>
              </TRow>
            ))}
          </TBody>
        </Table>
        <Pagination page={pagina} total={238} pageSize={20} onChange={setPagina} />
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle title="Badge e Callout" hint="Linha de luz interna em ambos." />
        <div className="mb-5 flex flex-wrap gap-2">
          <Badge tom="paid">Pago</Badge>
          <Badge tom="pending">Pendente</Badge>
          <Badge tom="neutral">Neutro</Badge>
          <Badge tom="danger">Falhou</Badge>
          <Badge tom="info">Info</Badge>
          <Badge tom="accent">Destaque</Badge>
        </div>
        <Callout tom="ok">
          <strong>Tudo certo.</strong> Configuração salva.
        </Callout>
        <Callout tom="info">Informação neutra para o operador.</Callout>
        <Callout tom="warn">Atenção: o gateway está em modo de teste.</Callout>
        <Callout tom="err" className="mb-0">
          <strong>Falhou.</strong> A credencial foi recusada pelo provedor.
        </Callout>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card wide>
        <CardTitle title="SaveBar" hint="Presa ao rodapé do cartão; no celular, sempre visível." />
        <p className="text-sm text-ink-2">
          Estado: {sujo ? 'há alterações' : 'limpo'}.{' '}
          <Button variant="link" onClick={() => setSujo(true)}>
            Sujar de novo
          </Button>
        </p>
        <SaveBar dirty={sujo} saving={salvando} onSave={salvar} onReset={() => setSujo(false)} />
      </Card>
    </PageBackdrop>
  );
}
