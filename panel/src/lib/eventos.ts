/* ==========================================================================
   Nomes dos eventos do funil

   Mora aqui, e não dentro da tela de Eventos, porque a jornada do cliente
   (dentro do dashboard) precisa exatamente da mesma tradução. Duas listas
   paralelas envelheceriam separadas: um evento novo apareceria traduzido em
   uma tela e cru na outra.

   O valor técnico nunca some da interface — quem configura o GTM precisa do
   nome exato. O rótulo é só a tradução ao lado.
   ========================================================================== */

export const EVENTOS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os eventos' },
  { value: 'page_view', label: 'Visualização de página' },
  { value: 'view_content', label: 'Viu o conteúdo' },
  { value: 'select_promotion', label: 'Viu a oferta' },
  { value: 'click', label: 'Clique' },
  { value: 'begin_checkout', label: 'Checkout aberto' },
  { value: 'coupon_applied', label: 'Cupom aplicado' },
  { value: 'coupon_rejected', label: 'Cupom recusado' },
  { value: 'checkout_abandoned', label: 'Checkout abandonado' },
  { value: 'generate_lead', label: 'Lead gerado' },
  { value: 'add_payment_info', label: 'Pix gerado' },
  { value: 'pix_abandoned', label: 'Pix abandonado' },
  { value: 'purchase', label: 'Compra' },
];

export const ROTULO_EVENTO = new Map(EVENTOS.filter((e) => e.value).map((e) => [e.value, e.label]));

/** O rótulo em português, ou o próprio nome técnico quando for um evento novo. */
export function rotuloDoEvento(event: string): string {
  return ROTULO_EVENTO.get(event) ?? event;
}
