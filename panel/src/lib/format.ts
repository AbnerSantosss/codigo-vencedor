/* Formatação — tudo em pt-BR, e sempre a partir de centavos inteiros.
   Dinheiro em float é como um preço de R$ 27,90 se transforma em 27,899999. */

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moedaCurta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});
const numero = new Intl.NumberFormat('pt-BR');
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export const brl = (cents: number): string => moeda.format((cents ?? 0) / 100);
export const brlCurto = (cents: number): string => moedaCurta.format((cents ?? 0) / 100);
export const num = (v: number): string => numero.format(v ?? 0);

export function pct(v: number | null | undefined, digitos = 1): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(digitos).replace('.', ',')}%`;
}

export function quando(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '—' : dataHora.format(d);
}

export function diaCurto(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : dataCurta.format(d);
}

/** "há 3 min", "há 2 h", "há 4 d" — para listas de abandono e eventos. */
export function haQuantoTempo(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (Number.isNaN(min)) return '—';
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/** Centavos a partir de um campo digitado ("27,90" ou "27.90"). */
export function centavosDe(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(',', '.');
  const valor = Number.parseFloat(limpo);
  return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
}

/** Centavos para o campo de texto ("2790" → "27,90"). */
export function reaisDe(cents: number): string {
  return ((cents ?? 0) / 100).toFixed(2).replace('.', ',');
}
