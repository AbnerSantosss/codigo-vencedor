/**
 * Gerador de BR Code (o "Pix copia e cola").
 *
 * O formato é o EMV® QR Code do Banco Central: uma sequência de campos
 * `IDTAMANHOVALOR`, onde ID e TAMANHO têm sempre 2 dígitos. O último campo é
 * sempre o CRC16 do que veio antes — inclusive do próprio cabeçalho "6304".
 *
 * Referência: Manual de Padrões para Iniciação do Pix (BCB), seção do QR Code.
 */

/** Monta um campo no formato ID + tamanho (2 dígitos) + valor. */
function field(id: string, value: string): string {
  const length = String(value.length).padStart(2, '0');
  return `${id}${length}${value}`;
}

/**
 * CRC16/CCITT-FALSE — polinômio 0x1021, valor inicial 0xFFFF, sem reflexão.
 * É a variante exigida pelo BCB; usar outra faz o app do banco recusar o
 * código com uma mensagem genérica de "QR inválido".
 */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Remove acento e caractere fora do ASCII imprimível.
 *
 * Nome e cidade do recebedor precisam ser ASCII: com acento, boa parte dos
 * aplicativos de banco lê o código torto ou recusa.
 */
function sanitize(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    // Marcas de acentuação separadas pelo NFD.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, maxLength);
}

export interface BrCodeInput {
  /** Chave Pix: CPF/CNPJ, e-mail, telefone (+55...) ou chave aleatória. */
  key: string;
  merchantName: string;
  merchantCity: string;
  amountCents: number;
  /** Identificador do pedido que volta na conciliação. Só A-Z, 0-9, até 25. */
  txid: string;
  /** `true` gera um código de uso único (não reutilizável). */
  oneTime?: boolean;
}

export function buildBrCode(input: BrCodeInput): string {
  const txid = sanitize(input.txid, 25).replace(/[^A-Z0-9]/g, '') || '***';

  const merchantAccount = field('00', 'br.gov.bcb.pix') + field('01', input.key.trim());

  const payload =
    field('00', '01') +
    (input.oneTime ? field('01', '12') : '') +
    field('26', merchantAccount) +
    field('52', '0000') +
    field('53', '986') +
    field('54', (input.amountCents / 100).toFixed(2)) +
    field('58', 'BR') +
    field('59', sanitize(input.merchantName, 25)) +
    field('60', sanitize(input.merchantCity, 15)) +
    field('62', field('05', txid));

  // O CRC é calculado sobre o payload já com "6304" no fim.
  const withCrcHeader = `${payload}6304`;
  return withCrcHeader + crc16(withCrcHeader);
}

/** Confere um BR Code recebido: os 4 últimos dígitos devem bater com o CRC. */
export function isValidBrCode(code: string): boolean {
  if (code.length < 8) return false;
  const body = code.slice(0, -4);
  const given = code.slice(-4).toUpperCase();
  return crc16(body) === given;
}
