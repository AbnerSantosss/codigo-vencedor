import QRCode from 'qrcode';
import { buildBrCode } from './brcode.js';
import { SECRET_KEYS, getSecrets } from '../services/secrets.js';
import type { PaymentGateway, PixCharge } from './types.js';

/**
 * Pix estático — a chave do próprio lojista, sem intermediário.
 *
 * Gera um BR Code válido com valor e identificador do pedido. Não há webhook:
 * o dinheiro cai direto na conta e a baixa é feita no painel, conferindo o
 * extrato. É a rede de segurança para a página nunca ficar sem meio de venda.
 *
 * **Sem chave configurada**, gera um código de DEMONSTRAÇÃO: mesma estrutura,
 * mesmo CRC, mas com uma chave que não existe. Serve para testar o fluxo
 * inteiro — formulário, QR, contador de expiração, confirmação — antes de o
 * lojista ter uma chave cadastrada. A cobrança volta marcada com
 * `simulated: true` e a página avisa o visitante em vermelho.
 */
export const staticPixGateway: PaymentGateway = {
  id: 'static_pix',
  label: 'Pix estático',

  async createPixCharge({ order, expiresInMin }): Promise<PixCharge> {
    const secrets = await getSecrets([
      SECRET_KEYS.staticPixKey,
      SECRET_KEYS.staticPixName,
      SECRET_KEYS.staticPixCity,
    ]);

    const key = secrets[SECRET_KEYS.staticPixKey];
    const simulated = !key;

    const emv = buildBrCode({
      // A chave de demonstração é deliberadamente impossível de existir:
      // ninguém consegue pagar por engano.
      key: key ?? 'demonstracao-sem-chave@codigovencedor.invalid',
      merchantName: secrets[SECRET_KEYS.staticPixName] ?? 'DEMONSTRACAO',
      merchantCity: secrets[SECRET_KEYS.staticPixCity] ?? 'SAO PAULO',
      amountCents: order.amountCents,
      txid: order.reference.replace(/-/g, ''),
      oneTime: true,
    });

    const qrCodeBase64 = (
      await QRCode.toDataURL(emv, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512,
        color: { dark: '#000000', light: '#ffffff' },
      })
    ).replace(/^data:image\/png;base64,/, '');

    return {
      providerOrderId: order.reference,
      providerPaymentId: null,
      emv,
      qrCodeBase64,
      expiresAt: new Date(Date.now() + expiresInMin * 60_000),
      simulated,
    };
  },

  /**
   * Pix estático não tem consulta: o banco não nos avisa de nada. Devolver
   * `null` (em vez de `pending`) mantém honesto quem lê — a informação não
   * existe, e quem decide é o lojista olhando o extrato.
   */
  async getStatus() {
    return null;
  },
};
