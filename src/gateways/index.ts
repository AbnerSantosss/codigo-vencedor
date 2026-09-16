import { getSiteConfig } from '../services/config.js';
import { SECRET_KEYS, getSecret, getSecrets } from '../services/secrets.js';
import { appmaxGateway } from './appmax.js';
import { fyhubGateway } from './fyhub.js';
import { mercadoPagoGateway } from './mercadopago.js';
import { staticPixGateway } from './staticPix.js';
import type { GatewayId } from '@prisma/client';
import type { PaymentGateway } from './types.js';

/**
 * Escolhe o adaptador de pagamento a partir da configuração do painel.
 *
 * A regra é "provedor escolhido E credencial presente". Escolher Mercado
 * Pago no painel sem ter colado o token ainda cai no Pix estático — que, sem
 * chave, gera um código de demonstração. É melhor do que derrubar o checkout
 * com "provedor não configurado" na cara do comprador.
 *
 * A Appmax segue a mesma regra: só atende com o par client_id/client_secret
 * gravado.
 */
export async function resolveGateway(): Promise<PaymentGateway> {
  const cfg = await getSiteConfig();

  switch (cfg.gatewayActive) {
    case 'mercadopago':
      return (await getSecret(SECRET_KEYS.mpAccessToken)) ? mercadoPagoGateway : staticPixGateway;
    case 'appmax':
      return (await getSecret(SECRET_KEYS.appmaxClientId)) && (await getSecret(SECRET_KEYS.appmaxClientSecret))
        ? appmaxGateway
        : staticPixGateway;
    /**
     * A FyHub precisa de cinco coisas, e a falta de qualquer uma produz um
     * fracasso diferente e igualmente inutil para o comprador: sem o par
     * client_id/client_secret nao ha token, sem o certificado a conexao nem
     * se estabelece, e sem a chave Pix a cobranca e recusada por falta de
     * recebedor. Conferir as cinco aqui e o que faz uma integracao pela
     * metade cair no Pix estatico em vez de derrubar o checkout.
     */
    case 'fyhub': {
      const s = await getSecrets([
        SECRET_KEYS.fyhubClientId,
        SECRET_KEYS.fyhubClientSecret,
        SECRET_KEYS.fyhubCertPem,
        SECRET_KEYS.fyhubKeyPem,
        SECRET_KEYS.fyhubPixKey,
      ]);
      const completo =
        s[SECRET_KEYS.fyhubClientId] &&
        s[SECRET_KEYS.fyhubClientSecret] &&
        s[SECRET_KEYS.fyhubCertPem] &&
        s[SECRET_KEYS.fyhubKeyPem] &&
        s[SECRET_KEYS.fyhubPixKey];
      return completo ? fyhubGateway : staticPixGateway;
    }
    case 'static_pix':
    default:
      return staticPixGateway;
  }
}

/**
 * O adaptador de um provedor específico, independentemente de qual está
 * ativo — é o que o "testar conexão" do painel usa para conferir a
 * credencial do provedor escolhido na tela sem trocar o do site.
 */
export function gatewayPorId(id: GatewayId): PaymentGateway {
  switch (id) {
    case 'mercadopago':
      return mercadoPagoGateway;
    case 'appmax':
      return appmaxGateway;
    case 'fyhub':
      return fyhubGateway;
    case 'static_pix':
    default:
      return staticPixGateway;
  }
}

export { appmaxGateway, fyhubGateway, mercadoPagoGateway, staticPixGateway };
export type { PaymentGateway } from './types.js';
