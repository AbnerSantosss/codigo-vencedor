import { useMemo } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { brl, diaCurto, num } from '@/lib/format';
import type { DailySeries, SourcesResponse } from '@/lib/types';

/**
 * Chart.js — só os módulos usados.
 *
 * Registro explícito em vez de `registerables`: evita arrastar rosca, radar,
 * bolha e escalas de tempo para dentro do bundle do painel. E o Chart.js vem
 * do `node_modules` para o bundle, não de CDN — a CSP do /admin não libera
 * terceiro nenhum.
 */
ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
);

/**
 * Paleta lida dos tokens do CSS.
 *
 * O Chart.js pinta num canvas e não resolve `var(--…)` — mas o JS resolve.
 * Ler o token em vez de repetir o hexadecimal aqui é o que evita o defeito
 * antigo: a paleta mudou no CSS e os gráficos ficaram apontando para a cor
 * velha, sem nada acusar. O reserva existe porque token faltando devolve
 * string vazia, e cor vazia no Chart.js desenha preto sobre fundo escuro —
 * o gráfico desaparece.
 */
function paleta() {
  const css = getComputedStyle(document.documentElement);
  const ler = (nome: string, reserva: string) => css.getPropertyValue(nome).trim() || reserva;
  return {
    ink: ler('--color-ink', '#eef2ee'),
    muted: ler('--color-muted', '#93a099'),
    grid: ler('--color-line', '#232b26'),
    surface: ler('--color-surface', '#121714'),
    surface2: ler('--color-surface-2', '#1a211c'),
    accent: ler('--color-accent', '#f5c518'),
    accentSoft: ler('--color-accent-soft', 'rgba(245, 197, 24, .13)'),
    info: ler('--color-info', '#60a5fa'),
  };
}

/* ------------------------------------------------------------------ *
 * Receita por dia
 * ------------------------------------------------------------------ */

export function GraficoReceita({ series }: { series: DailySeries['series'] }) {
  const cores = useMemo(paleta, []);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      // Série única: o título do cartão já diz o que é.
      legend: { display: false },
      tooltip: {
        backgroundColor: cores.surface2,
        borderColor: cores.grid,
        borderWidth: 1,
        titleColor: cores.ink,
        bodyColor: cores.ink,
        padding: 10,
        displayColors: false,
        callbacks: {
          label: (item) => {
            const p = series[item.dataIndex];
            if (!p) return '';
            return `${brl(p.revenueCents)} · ${p.orders} ${p.orders === 1 ? 'pedido' : 'pedidos'}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: cores.muted, font: { size: 11 } },
        border: { color: cores.grid },
      },
      y: {
        beginAtZero: true,
        grid: { color: cores.grid },
        border: { display: false },
        ticks: {
          color: cores.muted,
          font: { size: 11 },
          callback: (v) => (Number(v) === 0 ? '0' : `R$ ${Number(v).toLocaleString('pt-BR')}`),
        },
      },
    },
  };

  return (
    <Line
      options={options}
      data={{
        labels: series.map((p) => diaCurto(p.date)),
        datasets: [
          {
            label: 'Receita',
            data: series.map((p) => p.revenueCents / 100),
            borderColor: cores.accent,
            backgroundColor: cores.accentSoft,
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: cores.accent,
            pointBorderColor: cores.surface,
            pointBorderWidth: 2,
          },
        ],
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Origem do tráfego
 * ------------------------------------------------------------------ */

/**
 * Barras horizontais, não rosca.
 *
 * Uma rosca precisaria de uma cor por fonte, e o limite de cores
 * categóricas distinguíveis por quem tem daltonismo é três nesta
 * superfície — o que obrigava a jogar o resto num balde "outras" que, com o
 * tráfego espalhado, virava o maior pedaço do gráfico. Barra de uma cor só
 * não tem esse teto, e comparar comprimento é mais preciso do que ângulo.
 */
export function GraficoOrigens({ sources }: { sources: SourcesResponse['sources'] }) {
  const cores = useMemo(paleta, []);
  const total = sources.reduce((s, x) => s + x.sessions, 0);

  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cores.surface2,
        borderColor: cores.grid,
        borderWidth: 1,
        titleColor: cores.ink,
        bodyColor: cores.ink,
        padding: 10,
        displayColors: false,
        callbacks: {
          label: (item) => {
            const parte = total ? ((Number(item.parsed.x) / total) * 100).toFixed(0) : 0;
            return `${num(Number(item.parsed.x))} sessões · ${parte}% do total`;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: cores.grid },
        border: { display: false },
        ticks: { color: cores.muted, font: { size: 11 }, precision: 0 },
      },
      y: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: cores.ink, font: { size: 12 } },
      },
    },
  };

  return (
    <Bar
      options={options}
      data={{
        labels: sources.map((s) => s.source),
        datasets: [
          {
            data: sources.map((s) => s.sessions),
            backgroundColor: cores.info,
            borderRadius: 4,
            borderSkipped: false,
            barThickness: 16,
          },
        ],
      }}
    />
  );
}

/**
 * Caixa de gráfico com altura definida.
 *
 * O Chart.js com `maintainAspectRatio: false` precisa de um contêiner com
 * altura: sem isso o canvas cresce a cada quadro, sem parar.
 */
export function CaixaGrafico({ altura, children }: { altura: string; children: React.ReactNode }) {
  return (
    <div className="relative" style={{ height: altura }}>
      {children}
    </div>
  );
}
