/* ------------------------------------------------------------------ *
 * Gráficos do dashboard
 *
 * `Chart` é global: vem de /admin/vendor/chart.min.js, carregado como
 * script clássico no index.html. Não há import — é o mesmo objeto de
 * antes, lido do escopo global.
 * ------------------------------------------------------------------ */

import { brl, num } from './ui.js';

/**
 * Paleta dos gráficos, lida dos tokens do `admin.css`.
 *
 * O Chart.js pinta no canvas e não resolve `var(--…)` — mas o JS resolve:
 * `getComputedStyle` devolve o valor já calculado da custom property. Antes
 * estes valores eram literais aqui dentro, e quando a paleta do CSS mudou
 * eles ficaram apontando para a antiga, sem que nada acusasse. Lendo do
 * token, o `admin.css` volta a ser a única fonte de verdade.
 *
 * Preguiçoso e memoizado: a leitura só acontece no primeiro gráfico (aí o
 * CSS já está aplicado, o que não é garantido no instante em que o módulo é
 * avaliado), e o `getComputedStyle` não se repete a cada redesenho.
 *
 * O fallback não é decoração: se o token faltar, `getPropertyValue` devolve
 * string vazia, e o Chart.js com cor vazia desenha em preto sobre fundo
 * escuro — o gráfico simplesmente desaparece.
 */
let paleta = null;

function tokens() {
  if (paleta) return paleta;
  const css = getComputedStyle(document.documentElement);
  const ler = (nome, reserva) => css.getPropertyValue(nome).trim() || reserva;
  paleta = {
    text: ler('--ad-text', '#eef2ee'),
    muted: ler('--ad-muted', '#93a099'),
    grid: ler('--ad-border', '#232b26'),
    surface: ler('--ad-surface', '#121714'),
    surface2: ler('--ad-surface-2', '#1a211c'),
    accent: ler('--ad-accent', '#f5c518'),
    accentSoft: ler('--ad-accent-soft', 'rgba(245, 197, 24, .13)'),
    info: ler('--ad-info', '#60a5fa'),
  };
  return paleta;
}

export function lineChart(canvas, series) {
  const ink = tokens();
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: series.map((p) => {
        const [, m, d] = p.date.split('-');
        return `${d}/${m}`;
      }),
      datasets: [
        {
          label: 'Receita',
          data: series.map((p) => p.revenueCents / 100),
          borderColor: ink.accent,
          backgroundColor: ink.accentSoft,
          borderWidth: 2,
          fill: true,
          tension: 0.25,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: ink.accent,
          pointBorderColor: ink.surface,
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Série única: o título do cartão já diz o que é.
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ink.surface2,
          borderColor: ink.grid,
          borderWidth: 1,
          titleColor: ink.text,
          bodyColor: ink.text,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (item) => {
              const p = series[item.dataIndex];
              return `${brl(p.revenueCents)} · ${p.orders} ${p.orders === 1 ? 'pedido' : 'pedidos'}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink.muted, font: { size: 11 } }, border: { color: ink.grid } },
        y: {
          beginAtZero: true,
          grid: { color: ink.grid },
          border: { display: false },
          ticks: {
            color: ink.muted,
            font: { size: 11 },
            callback: (v) => (v === 0 ? '0' : `R$ ${Number(v).toLocaleString('pt-BR')}`),
          },
        },
      },
    },
  });
}

/**
 * Origem do tráfego em barras horizontais.
 *
 * Não é rosca de propósito. Uma rosca precisaria de uma cor por fonte, e o
 * limite de cores categóricas distinguíveis por quem tem daltonismo é três
 * nesta superfície — o que obrigava a jogar todo o resto num balde "outras"
 * que, com o tráfego espalhado, virava o maior pedaço do gráfico. Barra de
 * uma cor só não tem esse teto, e comparar comprimento é mais preciso do
 * que comparar ângulo.
 */
export function sourcesChart(canvas, sources) {
  const ink = tokens();
  const total = sources.reduce((s, x) => s + x.sessions, 0);
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sources.map((s) => s.source),
      datasets: [
        {
          data: sources.map((s) => s.sessions),
          backgroundColor: ink.info,
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 16,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ink.surface2,
          borderColor: ink.grid,
          borderWidth: 1,
          titleColor: ink.text,
          bodyColor: ink.text,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (item) => {
              const pct = total ? ((item.parsed.x / total) * 100).toFixed(0) : 0;
              return `${num(item.parsed.x)} sessões · ${pct}% do total`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: ink.grid },
          border: { display: false },
          ticks: { color: ink.muted, font: { size: 11 }, precision: 0 },
        },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: ink.text, font: { size: 12 } } },
      },
    },
  });
}
