import { readFile } from 'node:fs/promises';
import { isProd } from '../env.js';

const cache = new Map<string, string>();

/**
 * Lê um HTML do disco e substitui `{{nonce}}`.
 *
 * Em produção o arquivo é lido uma vez e fica em memória; em desenvolvimento
 * relê sempre, para editar o HTML sem reiniciar o servidor. A substituição é
 * feita a cada request porque o nonce muda a cada request — é isso que dá
 * valor ao nonce.
 */
export async function renderHtml(filePath: string, vars: Record<string, string>): Promise<string> {
  let raw = isProd ? cache.get(filePath) : undefined;

  if (raw === undefined) {
    raw = await readFile(filePath, 'utf8');
    if (isProd) cache.set(filePath, raw);
  }

  let out = raw;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

/** Escapa texto que vai para dentro de um atributo ou nó de texto HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
