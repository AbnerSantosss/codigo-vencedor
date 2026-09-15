import {
  Activity,
  CreditCard,
  MousePointerClick,
  Ticket,
  FileText,
  Flame,
  LayoutDashboard,
  Link2,
  Mail,
  Palette,
  Radar,
  ShoppingCart,
  UserCog,
  Users,
  Webhook,
  LifeBuoy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface Tela {
  id: string;
  label: string;
  grupo: 'Vendas' | 'Landing page' | 'Sistema';
  icone: LucideIcon;
  titulo: string;
  sub: string;
  /** Só administrador (`owner`) enxerga. O servidor também barra — a tela
   *  escondida é conveniência, o `requireOwner` é a regra. */
  ownerOnly?: boolean;
}

export const TELAS: Tela[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    grupo: 'Vendas',
    icone: LayoutDashboard,
    titulo: 'Dashboard',
    sub: 'Suas vendas e o funil da página.',
  },
  {
    id: 'recuperacao',
    label: 'Recuperação',
    grupo: 'Vendas',
    icone: LifeBuoy,
    titulo: 'Recuperação de vendas',
    sub: 'Quem preencheu e não gerou o Pix, quem gerou e não pagou — e o que foi feito para trazer de volta.',
  },
  {
    id: 'checkout',
    label: 'Checkout',
    grupo: 'Vendas',
    icone: ShoppingCart,
    titulo: 'Checkout',
    sub: 'Formulário na própria página ou botão para um link externo.',
  },
  {
    id: 'gateway',
    label: 'Gateway',
    grupo: 'Vendas',
    icone: CreditCard,
    titulo: 'Gateway de pagamento',
    sub: 'Provedor, ambiente e credenciais. As credenciais ficam cifradas no banco e nunca voltam para esta tela.',
  },
  {
    id: 'rastreamento',
    label: 'Rastreamento',
    grupo: 'Vendas',
    icone: Radar,
    titulo: 'Rastreamento',
    sub: 'Pixel da Meta, API de Conversões e as demais plataformas.',
  },
  {
    id: 'eventos',
    label: 'Eventos',
    grupo: 'Vendas',
    icone: Activity,
    titulo: 'Eventos',
    sub: 'O que acontece no site: funil, origem do tráfego e os últimos disparos.',
  },
  {
    id: 'cliques',
    label: 'Cliques',
    grupo: 'Vendas',
    icone: MousePointerClick,
    titulo: 'Cliques',
    sub: 'Em que botão, em que parte da página e em que rota as pessoas clicaram.',
  },
  {
    id: 'cupons',
    label: 'Cupons',
    grupo: 'Vendas',
    icone: Ticket,
    titulo: 'Cupons de desconto',
    sub: 'O cliente digita o código no checkout; o desconto sai daqui. Nenhum cupom baixa do mínimo do Pix.',
  },
  {
    id: 'conteudo',
    label: 'Conteúdo',
    grupo: 'Landing page',
    icone: FileText,
    titulo: 'Conteúdo',
    sub: 'Preço e informações da oferta.',
  },
  {
    id: 'aparencia',
    label: 'Aparência',
    grupo: 'Landing page',
    icone: Palette,
    titulo: 'Aparência',
    sub: 'A paleta da landing page.',
  },
  {
    id: 'escassez',
    label: 'Escassez',
    grupo: 'Landing page',
    icone: Flame,
    titulo: 'Escassez',
    sub: 'Contador, vagas, compradores e o aviso de compra recente.',
  },
  {
    id: 'links',
    label: 'Links e redes',
    grupo: 'Landing page',
    icone: Link2,
    titulo: 'Links e redes',
    sub: 'WhatsApp e perfis sociais do rodapé.',
  },
  {
    id: 'email',
    label: 'E-mail',
    grupo: 'Sistema',
    icone: Mail,
    titulo: 'E-mail',
    sub: 'Provedor de envio, templates e as regras dos e-mails automáticos.',
  },
  {
    id: 'webhooks',
    label: 'Integrações',
    grupo: 'Sistema',
    icone: Webhook,
    titulo: 'Integrações e webhooks',
    sub: 'Avise outro sistema quando uma venda acontecer — e veja o que os gateways nos avisaram.',
  },
  {
    id: 'usuarios',
    label: 'Usuários',
    grupo: 'Sistema',
    icone: Users,
    titulo: 'Usuários',
    sub: 'Quem entra no painel e com que papel. Convites chegam por e-mail com um link para criar a senha.',
    ownerOnly: true,
  },
  {
    id: 'conta',
    label: 'Minha conta',
    grupo: 'Sistema',
    icone: UserCog,
    titulo: 'Minha conta',
    sub: 'Seus dados de acesso e a troca de senha.',
  },
];

export const GRUPOS = ['Vendas', 'Landing page', 'Sistema'] as const;

export function telaPorId(id: string): Tela | undefined {
  return TELAS.find((t) => t.id === id);
}

export function podeVer(tela: Tela, role: string | undefined): boolean {
  return !tela.ownerOnly || role === 'owner';
}
