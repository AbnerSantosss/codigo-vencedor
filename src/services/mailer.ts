import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '../db.js';
import { getSiteConfig } from './config.js';
import { SECRET_KEYS, getSecret } from './secrets.js';

/**
 * Envio de e-mail.
 *
 * Um provedor por vez, escolhido no painel. Hoje existe o SMTP (Gmail com
 * senha de app, ou qualquer outro servidor); a interface é pequena de
 * propósito para Resend, SES ou o que vier entrarem como mais um `case`,
 * sem tocar em quem chama.
 *
 * Regras que valem para todo envio:
 *  - nunca lança para quem chamou: falha de e-mail não pode derrubar uma
 *    venda nem um cadastro;
 *  - todo envio, bem ou mal sucedido, deixa um `EmailLog` — é o que a tela
 *    de Pedidos mostra na linha do tempo;
 *  - o transporte é criado uma vez e reaproveitado; recriar a cada e-mail
 *    abriria uma conexão TLS nova por mensagem.
 */

export interface MailInput {
  to: string;
  subject: string;
  /** Texto puro — sempre presente, é o que leitores antigos mostram. */
  text: string;
  /** HTML opcional; quando ausente é gerado a partir do texto. */
  html?: string;
  template: string;
  orderId?: string | null;
}

export interface MailResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

interface Provider {
  readonly id: string;
  send(input: MailInput & { from: string }): Promise<{ messageId?: string }>;
  verify(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * SMTP
 * ------------------------------------------------------------------ */

let smtpCache: { key: string; transporter: Transporter } | null = null;

async function smtpProvider(): Promise<Provider> {
  const cfg = await getSiteConfig();
  const password = await getSecret(SECRET_KEYS.emailApiKey);
  const { host, port, secure, user } = cfg.email.smtp;

  if (!host || !user || !password) throw new Error('smtp_incompleto');

  // A chave do cache é a configuração inteira: mudou host ou usuário no
  // painel, o transporte antigo é descartado.
  const key = `${host}|${port}|${secure}|${user}`;
  if (!smtpCache || smtpCache.key !== key) {
    smtpCache = {
      key,
      transporter: nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass: password },
        // Gmail responde rápido; 10s já é generoso e evita uma venda
        // esperando um servidor de e-mail que caiu.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    };
  }

  const transporter = smtpCache.transporter;
  return {
    id: 'smtp',
    async send(input) {
      const info = await transporter.sendMail({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html ?? textToHtml(input.text),
      });
      return { messageId: info.messageId };
    },
    async verify() {
      await transporter.verify();
    },
  };
}

export function invalidateMailerCache(): void {
  smtpCache = null;
}

/* ------------------------------------------------------------------ *
 * Seleção e envio
 * ------------------------------------------------------------------ */

async function resolveProvider(): Promise<Provider | null> {
  const cfg = await getSiteConfig();
  switch (cfg.email.provider) {
    case 'smtp':
      return smtpProvider();
    // case 'resend': return resendProvider();
    case 'none':
    default:
      return null;
  }
}

async function fromAddress(): Promise<string> {
  const cfg = await getSiteConfig();
  const name = cfg.email.fromName || 'Código Vencedor';
  // Sem remetente próprio, usa o usuário do SMTP: o Gmail recusa remetente
  // que não seja a própria conta ou um alias verificado.
  const email = cfg.email.fromEmail || cfg.email.smtp.user;
  return `"${name.replace(/"/g, '')}" <${email}>`;
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  let provider: Provider | null = null;
  let result: MailResult;

  try {
    provider = await resolveProvider();
    if (!provider) {
      result = { ok: false, provider: 'none', error: 'email_nao_configurado' };
    } else {
      const { messageId } = await provider.send({ ...input, from: await fromAddress() });
      result = { ok: true, provider: provider.id, messageId };
    }
  } catch (err) {
    result = {
      ok: false,
      provider: provider?.id ?? 'desconhecido',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await prisma.emailLog
    .create({
      data: {
        orderId: input.orderId ?? null,
        to: input.to,
        template: input.template,
        provider: result.provider,
        status: result.ok ? 'enviado' : 'falhou',
        error: result.error ?? null,
        sentAt: result.ok ? new Date() : null,
      },
    })
    .catch(() => undefined);

  return result;
}

/** Testa a conexão sem enviar nada — usado pelo botão do painel. */
export async function verifyMailer(): Promise<{ ok: boolean; detail: string }> {
  try {
    const provider = await resolveProvider();
    if (!provider) return { ok: false, detail: 'Nenhum provedor de e-mail selecionado.' };
    await provider.verify();
    return { ok: true, detail: `Conexão com o servidor (${provider.id}) autenticada com sucesso.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/smtp_incompleto/.test(msg)) return { ok: false, detail: 'Preencha servidor, usuário e senha do SMTP.' };
    if (/535|Invalid login|BadCredentials/i.test(msg)) {
      return {
        ok: false,
        detail: 'O servidor recusou usuário/senha. No Gmail, a senha precisa ser uma senha de app (não a senha da conta), com a verificação em duas etapas ligada.',
      };
    }
    return { ok: false, detail: `Falha na conexão: ${msg}` };
  }
}

/* ------------------------------------------------------------------ *
 * Texto → HTML mínimo
 *
 * O HTML é uma versão do texto com quebras de linha e links clicáveis, num
 * layout que sobrevive ao Gmail e ao Outlook. Nada de template engine: o
 * conteúdo é o do texto, e o texto é a fonte da verdade.
 * ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function textToHtml(text: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0a7a2f;font-weight:600">$1</a>')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.55">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return (
    '<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f4;padding:24px 12px">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 28px;' +
    'font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#1a1f1b">' +
    '<div style="font-weight:800;font-size:20px;letter-spacing:-.3px;margin-bottom:20px">Código<span style="color:#e6b800">///</span> Vencedor</div>' +
    body +
    '<hr style="border:0;border-top:1px solid #e5e8e5;margin:24px 0 16px">' +
    '<p style="margin:0;font-size:12px;color:#7a837c">xWinner LTDA · CNPJ 12.711.431/0001-45</p>' +
    '</div></body></html>'
  );
}
