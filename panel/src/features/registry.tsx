import type { Me } from '@/lib/types';
import { TelaAparencia } from './screens/Aparencia';
import { TelaCheckout } from './screens/Checkout';
import { TelaCliques } from './screens/Cliques';
import { TelaCupons } from './screens/Cupons';
import { TelaConta } from './screens/Conta';
import { TelaConteudo } from './screens/Conteudo';
import { TelaDashboard } from './screens/Dashboard';
import { TelaEmail } from './screens/Email';
import { TelaEscassez } from './screens/Escassez';
import { TelaEventos } from './screens/Eventos';
import { TelaGateway } from './screens/Gateway';
import { TelaLinks } from './screens/Links';
import { TelaRastreamento } from './screens/Rastreamento';
import { TelaRecuperacao } from './screens/Recuperacao';
import { TelaUsuarios } from './screens/Usuarios';
import { TelaWebhooks } from './screens/Webhooks';

export interface PropsDeTela {
  me: Me | null;
}

/**
 * Id da tela → componente.
 *
 * A lista de telas (rótulo, grupo, ícone, quem pode ver) mora em
 * `components/shell/screens.ts`; aqui fica só o mapeamento para o
 * componente, para o menu não precisar importar as 16 telas.
 */
export const TELA_COMPONENTES: Record<string, React.ComponentType<PropsDeTela>> = {
  dashboard: TelaDashboard,
  recuperacao: TelaRecuperacao,
  checkout: TelaCheckout,
  gateway: TelaGateway,
  rastreamento: TelaRastreamento,
  eventos: TelaEventos,
  cliques: TelaCliques,
  cupons: TelaCupons,
  conteudo: TelaConteudo,
  aparencia: TelaAparencia,
  escassez: TelaEscassez,
  links: TelaLinks,
  email: TelaEmail,
  webhooks: TelaWebhooks,
  usuarios: TelaUsuarios,
  conta: TelaConta,
};
