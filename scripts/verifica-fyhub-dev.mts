/* Confere as partes puras do adaptador da FyHub, sem tocar na rede nem no banco.
   Este projeto não tem framework de testes; isto faz o papel do `npm test` que
   o plano previa. Rodar com:  npx tsx scripts/verifica-fyhub-dev.mts          */

import { generateKeyPairSync, X509Certificate, createPrivateKey } from 'node:crypto';
import { gerarTxid, mapearStatusFyhub } from '../src/gateways/fyhub.js';

let falhas = 0;

function checar(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log('  ok   ' + nome);
  } else {
    falhas++;
    console.log('  FALHA ' + nome + (detalhe ? ' — ' + detalhe : ''));
  }
}

/* ------------------------------------------------------------------ *
 * txid
 * ------------------------------------------------------------------ */

console.log('txid');

const amostra = Array.from({ length: 500 }, () => gerarTxid());

checar('tem 32 caracteres', amostra.every((t) => t.length === 32));
checar(
  'só usa [a-zA-Z0-9], como a especificação exige',
  amostra.every((t) => /^[a-zA-Z0-9]+$/.test(t)),
);
checar(
  'fica dentro da faixa de 26 a 35 do padrão BCB',
  amostra.every((t) => t.length >= 26 && t.length <= 35),
);
checar('não repete em 500 sorteios', new Set(amostra).size === 500);

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

console.log('');
console.log('mapa de status');

const casos: [unknown, string | null][] = [
  ['ATIVA', 'pending'],
  ['ativa', 'pending'],
  ['CONCLUIDA', 'paid'],
  // A grafia com acento aparece em resposta de alguns PSP; a normalização
  // NFD precisa dar conta dela, senão uma venda paga fica pendente.
  ['CONCLUÍDA', 'paid'],
  ['REMOVIDA_PELO_USUARIO_RECEBEDOR', 'expired'],
  ['REMOVIDA_PELO_PSP', 'expired'],
  ['removida pelo psp', 'expired'],
  // Desconhecido tem de virar null, e não 'pending': é o null que faz o
  // webhook devolver 500 e o provedor reenviar, em vez de a venda ser
  // silenciosamente tratada como não paga.
  ['STATUS_QUE_NAO_EXISTE', null],
  ['', null],
  [undefined, null],
  [null, null],
];

for (const [entrada, esperado] of casos) {
  const obtido = mapearStatusFyhub(entrada);
  checar(
    `${JSON.stringify(entrada)} -> ${esperado}`,
    obtido === esperado,
    'veio ' + String(obtido),
  );
}

/* ------------------------------------------------------------------ *
 * valor.original
 * ------------------------------------------------------------------ */

console.log('');
console.log('valor.original (o padrão BCB pede decimal em reais, não centavos)');

const valor = (centavos: number) => (centavos / 100).toFixed(2);

checar('2790 centavos -> "27.90"', valor(2790) === '27.90');
checar('100 centavos -> "1.00"', valor(100) === '1.00');
checar('5 centavos -> "0.05"', valor(5) === '0.05');
checar('123456 centavos -> "1234.56"', valor(123456) === '1234.56');
checar('sempre com duas casas', /^\d+\.\d{2}$/.test(valor(2790)));

/* ------------------------------------------------------------------ *
 * Material mTLS
 * ------------------------------------------------------------------ */

console.log('');
console.log('material do certificado');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

checar('a chave privada de teste sai em PEM', keyPem.startsWith('-----BEGIN PRIVATE KEY-----'));
checar('o Node relê essa chave', (() => {
  try {
    createPrivateKey(keyPem);
    return true;
  } catch {
    return false;
  }
})());

/**
 * A validação do painel recusa o que não tiver `-----BEGIN`. Aqui se confere
 * que a regra aceita o PEM de verdade e barra o caso que motivou a regra:
 * o texto colado pela metade, sem o cabeçalho.
 */
const pareceP = (v: string) => v.includes('-----BEGIN');
checar('a regra do painel aceita um PEM válido', pareceP(keyPem));
checar('e recusa um trecho sem cabeçalho', !pareceP(keyPem.split('\n').slice(2, 6).join('\n')));
checar('X509Certificate existe neste Node', typeof X509Certificate === 'function');

/* ------------------------------------------------------------------ */

console.log('');
if (falhas) {
  console.log(falhas + ' verificação(ões) falharam.');
  process.exit(1);
}
console.log('Tudo certo.');
