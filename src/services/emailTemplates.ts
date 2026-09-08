/**
 * Templates de e-mail.
 *
 * Cada template é assunto + corpo em texto, com variáveis `{{nome}}` etc.
 * Os padrões abaixo são o ponto de partida; o painel permite editar todos.
 * O corpo é texto puro de propósito: é o que o lojista consegue editar sem
 * quebrar, e o `mailer` gera o HTML a partir dele.
 */

export type TemplateId = 'purchase_approved' | 'checkout_abandoned' | 'pix_abandoned' | 'password_reset' | 'user_invite';

export interface EmailTemplate {
  subject: string;
  body: string;
}

export const TEMPLATE_META: Record<TemplateId, { label: string; hint: string; vars: string[] }> = {
  purchase_approved: {
    label: 'Compra aprovada',
    hint: 'Enviado no momento em que o pagamento é confirmado.',
    vars: ['nome', 'email', 'pedido', 'valor', 'link_acesso', 'suporte'],
  },
  checkout_abandoned: {
    label: 'Checkout abandonado',
    hint: 'Para quem digitou nome e e-mail e não concluiu. Enviado uma vez, depois do prazo configurado.',
    vars: ['nome', 'link_checkout', 'valor', 'suporte'],
  },
  pix_abandoned: {
    label: 'Pix não pago',
    hint: 'Para quem gerou o Pix e deixou expirar. Enviado uma vez, com um link para gerar outro.',
    vars: ['nome', 'pedido', 'link_checkout', 'valor', 'suporte'],
  },
  password_reset: {
    label: 'Recuperação de senha (painel)',
    hint: 'Link de uso único, válido por 30 minutos.',
    vars: ['nome', 'link_reset', 'minutos'],
  },
  user_invite: {
    label: 'Convite para o painel',
    hint: 'Enviado quando um administrador cadastra uma pessoa nova.',
    vars: ['nome', 'convidado_por', 'link_convite', 'horas'],
  },
};

export const DEFAULT_TEMPLATES: Record<TemplateId, EmailTemplate> = {
  purchase_approved: {
    subject: 'Seu acesso ao Código Vencedor chegou',
    body:
      'Olá, {{nome}}!\n\n' +
      'Seu pagamento foi confirmado e o acesso já está liberado.\n\n' +
      'Pedido: {{pedido}}\n' +
      'Valor: {{valor}}\n' +
      'Login: {{email}}\n\n' +
      'Entre por aqui: {{link_acesso}}\n\n' +
      'Comece pelo curso — ele explica a conta que a ferramenta faz. Depois abra o app e use as 8 ferramentas com calma.\n\n' +
      'Qualquer dúvida, é só responder este e-mail ou chamar no WhatsApp: {{suporte}}',
  },

  checkout_abandoned: {
    subject: '{{nome}}, seu acesso ficou reservado',
    body:
      'Oi, {{nome}}.\n\n' +
      'Vi que você começou a garantir o Código Vencedor e parou no meio. Acontece — mas o valor de {{valor}} continua valendo, e o acesso é liberado em segundos depois do Pix.\n\n' +
      'Para continuar de onde parou: {{link_checkout}}\n\n' +
      'O que você recebe: o curso completo, a calculadora esportiva e 1 mês de acesso ao app com as 8 ferramentas. E 7 dias de garantia — se não for para você, devolvemos.\n\n' +
      'Se ficou alguma dúvida antes de decidir, responde este e-mail ou chama no WhatsApp: {{suporte}}',
  },

  pix_abandoned: {
    subject: 'Seu Pix expirou — gere outro em 10 segundos',
    body:
      'Oi, {{nome}}.\n\n' +
      'O Pix do pedido {{pedido}} venceu antes de ser pago. Nada foi cobrado.\n\n' +
      'Se ainda quiser o acesso, é só gerar um novo — leva 10 segundos e o valor continua {{valor}}: {{link_checkout}}\n\n' +
      'Se desistiu, sem problema. Se foi algum problema com o pagamento, me conta por aqui ou no WhatsApp: {{suporte}}',
  },

  password_reset: {
    subject: 'Redefinir sua senha do painel',
    body:
      'Olá, {{nome}}.\n\n' +
      'Recebemos um pedido para redefinir a senha do seu acesso ao painel do Código Vencedor.\n\n' +
      'Use este link nos próximos {{minutos}} minutos: {{link_reset}}\n\n' +
      'O link funciona uma única vez. Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.',
  },

  user_invite: {
    subject: 'Você foi convidado para o painel do Código Vencedor',
    body:
      'Olá, {{nome}}.\n\n' +
      '{{convidado_por}} cadastrou você no painel do Código Vencedor.\n\n' +
      'Para criar sua senha e entrar, use este link nas próximas {{horas}} horas: {{link_convite}}\n\n' +
      'Se você não esperava este convite, pode ignorar este e-mail.',
  },
};

/**
 * Substitui `{{var}}` pelos valores. Variável sem valor vira string vazia
 * em vez de ficar `{{undefined}}` no e-mail do cliente.
 */
export function renderTemplate(tpl: EmailTemplate, vars: Record<string, string | number | null | undefined>): EmailTemplate {
  const fill = (s: string) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => String(vars[k] ?? ''));
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}
