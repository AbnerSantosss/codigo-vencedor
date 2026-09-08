/**
 * Validação de CPF pelos dígitos verificadores.
 *
 * Conferir só o comprimento não adianta: um CPF com 11 dígitos inválidos
 * passa daqui e só é recusado lá na frente pelo provedor de pagamento, já
 * com o comprador esperando o QR Code aparecer.
 */
export function isValidCpf(raw: string): boolean {
  const cpf = (raw || '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  // 000.000.000-00, 111.111.111-11 etc. passam na conta dos dígitos mas
  // não são CPFs reais.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(cpf[i]) * (t + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(cpf[t])) return false;
  }
  return true;
}

/** Telefone brasileiro: DDD válido + 8 ou 9 dígitos. */
export function isValidPhone(raw: string): boolean {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) return false;
  const ddd = Number(digits.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

/**
 * Código curto que o comprador cita no suporte. Sem vogais nem os
 * caracteres que se confundem na leitura (0/O, 1/I), para ninguém ditar
 * errado no WhatsApp.
 */
const ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXZ';

export function newReference(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `CV-${out}`;
}
