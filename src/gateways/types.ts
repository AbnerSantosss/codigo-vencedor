import type { GatewayId, Order } from '@prisma/client';

export interface ChargeCustomer {
  nome: string;
  email: string;
  cpf: string;
  fone: string;
  /**
   * IP de quem está comprando.
   *
   * A Appmax exige o IP para criar o cliente (é o que fecha a chave de
   * identificação dela: nome + e-mail + telefone + IP) e usa esse dado no
   * antifraude. O Mercado Pago e o Pix estático ignoram.
   */
  ip?: string;
}

export interface PixCharge {
  providerOrderId: string | null;
  providerPaymentId: string | null;
  /** O "copia e cola". */
  emv: string;
  /** PNG em base64, sem o prefixo `data:`. */
  qrCodeBase64: string | null;
  expiresAt: Date;
  /**
   * `true` quando a cobrança não é pagável de verdade — sem credencial
   * configurada, o sistema gera um código de demonstração para permitir
   * testar o fluxo inteiro. A landing page usa isto para avisar o visitante,
   * e o painel para liberar o botão de simular o pagamento.
   */
  simulated: boolean;
  raw?: unknown;
}

export type PaymentStatus = 'pending' | 'paid' | 'expired' | 'refunded' | 'failed';

export interface PaymentGateway {
  readonly id: GatewayId;
  /** Rótulo curto para o painel e para os logs. */
  readonly label: string;

  createPixCharge(input: {
    order: Pick<Order, 'id' | 'publicId' | 'reference' | 'amountCents'>;
    customer: ChargeCustomer;
    expiresInMin: number;
  }): Promise<PixCharge>;

  /**
   * Consulta o provedor. Volta `null` quando o provedor não tem como
   * responder — é o caso do Pix estático, onde a baixa é manual. Devolver
   * `null` é diferente de devolver `pending`: o primeiro diz "não sei", o
   * segundo afirma que não foi pago.
   */
  getStatus(ref: { providerOrderId: string | null; providerPaymentId: string | null }): Promise<PaymentStatus | null>;

  /**
   * Teste de conexão de verdade: chama o provedor com a credencial gravada e
   * conta o que ele respondeu.
   *
   * Existe porque a versão anterior do botão "Testar conexão" só conferia se
   * os campos estavam preenchidos e devolvia "credenciais presentes" — o
   * dono só descobriria um token errado na primeira venda perdida. O
   * `ambiente` volta junto para o painel poder avisar quando a credencial é
   * de teste e a loja está em produção (ou o contrário).
   */
  verifyCredentials?(): Promise<VerifyResult>;
}

export interface VerifyResult {
  ok: boolean;
  /** Frase pronta para a tela, em português. */
  detail: string;
  /** Identificação da conta do lado do provedor, quando ele informa. */
  account?: string | null;
  ambiente?: 'sandbox' | 'production' | 'desconhecido';
}
