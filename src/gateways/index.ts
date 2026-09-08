import { getSiteConfig } from '../services/config.js';
import { SECRET_KEYS, getSecret } from '../services/secrets.js';
import { appmaxGateway } from './appmax.js';
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
    case 'static_pix':
    default:
      return staticPixGateway;
  }
}

export { appmaxGateway, mercadoPagoGateway, staticPixGateway };
export type { PaymentGateway } from './types.js';
