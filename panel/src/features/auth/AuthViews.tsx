import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, descreverErro, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Callout, type Tom } from '@/components/ui/layout';
import { Surface } from '@/components/ui/surface';
import { PageBackdrop } from '@/components/ui/backdrop';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/* ==========================================================================
   Telas de autenticação: login, esqueci a senha, criar/redefinir senha e a
   troca obrigatória. Comportamento portado de `admin/js/auth-views.js`.

   O que estas telas propositalmente NÃO fazem: guardar e-mail, senha ou
   qualquer token em `localStorage`. A sessão vive só nos cookies `httpOnly`
   que o servidor escreve.

   Visual (F6): a página inteira é um `PageBackdrop` (grade + ruído + halos,
   tudo em CSS) e o formulário mora num `Surface tone="elevated"` com
   holofote — o mesmo cartão do resto do painel, sem CSS por classe. Nada
   aqui é `style=""` nem `<style>`: a CSP do /admin bloquearia calado.
   ========================================================================== */

function Moldura({
  titulo,
  sub,
  aviso,
  children,
  rodape,
  onSubmit,
  login = false,
}: {
  titulo: React.ReactNode;
  sub: string;
  aviso?: { tom: Tom; texto: string } | null;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  login?: boolean;
}) {
  return (
    // O `PageBackdrop` nasce com margens negativas para "sangrar" dentro do
    // AppShell; aqui ele é a raiz da página, então as margens voltam a zero —
    // senão sobra rolagem horizontal em 320px.
    <PageBackdrop
      as="main"
      className={cn(
        'mx-0 grid min-h-svh place-items-center rounded-none px-4 py-8 sm:mx-0 sm:px-6',
        // Só a tela de login (não "esqueci a senha" etc.) leva a foto de
        // estádio; as demais continuam com a grade+halos padrão.
        login && 'cv-login-backdrop',
      )}
    >
      <div className="grid w-full max-w-sm justify-items-center gap-6">
        {login ? (
          <header className="grid justify-items-center gap-3 text-center" aria-label="Código Vencedor — Backoffice">
            <a href="/" className="inline-flex rounded-sm" aria-label="Ir para o site">
              <img
                src="/assets/logo.png"
                width="640"
                height="238"
                alt="Código Vencedor"
                className="h-auto w-40 sm:w-44"
              />
            </a>
            <p className="text-2xs font-extrabold tracking-[0.13em] text-accent uppercase">
              Backoffice · Código Vencedor
            </p>
          </header>
        ) : null}

        <Surface tone="elevated" spotlight className="w-full px-4 py-6 sm:px-7 sm:py-7">
          <form onSubmit={onSubmit} className="min-w-0">
            <span
              className="mb-5 inline-flex size-12 items-center justify-center rounded-md bg-accent-soft text-accent inset-shadow-hi"
              aria-hidden
            >
              <ShieldCheck className="size-6" />
            </span>
            <h1 className="mb-1 text-2xl font-extrabold tracking-tight">{titulo}</h1>
            <p className="mb-6 text-sm leading-relaxed text-muted">{sub}</p>
            {aviso ? <Callout tom={aviso.tom}>{aviso.texto}</Callout> : null}
            <div className="grid gap-4">{children}</div>
            {rodape ? <div className="mt-5 text-center">{rodape}</div> : null}
            {login ? (
              <p className="mt-6 border-t border-line pt-4 text-center text-2xs text-muted">
                Acesso restrito a usuários autorizados.
              </p>
            ) : null}
          </form>
        </Surface>

        {login ? (
          <p className="inline-flex items-center gap-2 text-xs text-muted">
            <ShieldCheck className="size-4 text-ok" aria-hidden />
            Área exclusiva da equipe
          </p>
        ) : null}
      </div>
    </PageBackdrop>
  );
}

const Marca = (
  <>
    Código <span className="text-accent">///</span> Vencedor
  </>
);

/* ------------------------------------------------------------------ *
 * Login
 * ------------------------------------------------------------------ */

interface LoginResponse {
  user: { email: string; name: string | null; role: 'owner' | 'editor' };
  mustChangePassword: boolean;
}

export function Login({
  mensagem,
  tom = 'err',
  onEntrou,
  onEsqueci,
}: {
  mensagem?: string | null;
  tom?: Tom;
  onEntrou: (r: LoginResponse) => void;
  onEsqueci: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password: senha },
      });
      onEntrou(res);
    } catch (err) {
      // Mensagem genérica de propósito no servidor: não dizemos se o e-mail
      // existe. Aqui só traduzimos o código para português.
      if (err instanceof ApiError && err.data.error === 'credenciais_invalidas') {
        setErro('E-mail ou senha incorretos.');
      } else if (err instanceof ApiError && err.data.error === 'conta_bloqueada') {
        setErro(
          `Conta bloqueada por ${(err.data.minutes as number) ?? 15} minutos após tentativas seguidas.`,
        );
      } else {
        setErro(descreverErro(err));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura
      login
      titulo="Bem-vindo de volta"
      sub="Entre com seus dados para acessar o painel."
      aviso={erro ? { tom: 'err', texto: erro } : mensagem ? { tom, texto: mensagem } : null}
      onSubmit={submeter}
      rodape={
        <Button variant="link" onClick={() => onEsqueci(email.trim())}>
          Esqueci minha senha
        </Button>
      }
    >
      <Field label="E-mail" htmlFor="login-email">
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Senha" htmlFor="login-senha">
        <Input
          id="login-senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
      </Field>
      <Button type="submit" block loading={enviando}>
        Entrar no painel
      </Button>
    </Moldura>
  );
}

/* ------------------------------------------------------------------ *
 * Esqueci minha senha
 * ------------------------------------------------------------------ */

export function Forgot({ prefill = '', onVoltar }: { prefill?: string; onVoltar: () => void }) {
  const [email, setEmail] = useState(prefill);
  const [aviso, setAviso] = useState<{ tom: Tom; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const res = await api<{ message: string }>('/auth/forgot', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setAviso({ tom: 'ok', texto: res.message });
      setPronto(true);
    } catch (err) {
      setAviso({
        tom: 'err',
        texto:
          err instanceof ApiError && err.status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos.'
            : descreverErro(err),
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura
      titulo={Marca}
      sub="Informe o e-mail da sua conta. Se ele tiver acesso ao painel, você recebe um link válido por 30 minutos."
      aviso={aviso}
      onSubmit={submeter}
      rodape={
        <Button variant="link" onClick={onVoltar}>
          Voltar ao login
        </Button>
      }
    >
      <Field label="E-mail" htmlFor="forgot-email">
        <Input
          id="forgot-email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" block loading={enviando} disabled={pronto}>
        Enviar link de redefinição
      </Button>
    </Moldura>
  );
}

/* ------------------------------------------------------------------ *
 * Criar / redefinir senha por link de e-mail
 * ------------------------------------------------------------------ */

const REGRA_SENHA = 'Mínimo de 12 caracteres, com maiúscula, minúscula e número.';

export function SetPassword({
  token,
  kind,
  onPronto,
  onDesistir,
}: {
  token: string;
  kind: 'reset' | 'convite';
  onPronto: (mensagem: string) => void;
  onDesistir: () => void;
}) {
  const convite = kind === 'convite';
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== confirma) {
      setErro('A confirmação não confere com a senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api('/auth/reset', { method: 'POST', body: { token, newPassword: nova } });
      onPronto(
        convite
          ? 'Senha criada. Entre com seu e-mail e a nova senha.'
          : 'Senha redefinida. Entre com a nova senha.',
      );
    } catch (err) {
      setErro(descreverErro(err));
      setEnviando(false);
    }
  }

  return (
    <Moldura
      titulo={Marca}
      sub={
        convite
          ? 'Bem-vindo ao painel. Crie a senha que você vai usar para entrar.'
          : 'Escolha a nova senha do seu acesso ao painel.'
      }
      aviso={erro ? { tom: 'err', texto: erro } : null}
      onSubmit={submeter}
      rodape={
        <Button variant="link" onClick={onDesistir}>
          {convite ? 'Voltar ao login' : 'Pedir outro link'}
        </Button>
      }
    >
      <Field label="Nova senha" hint={REGRA_SENHA} htmlFor="nova">
        <Input
          id="nova"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={nova}
          onChange={(e) => setNova(e.target.value)}
        />
      </Field>
      <Field label="Confirme a senha" htmlFor="confirma">
        <Input
          id="confirma"
          type="password"
          autoComplete="new-password"
          required
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
        />
      </Field>
      <Button type="submit" block loading={enviando}>
        {convite ? 'Criar senha' : 'Salvar nova senha'}
      </Button>
    </Moldura>
  );
}

/* ------------------------------------------------------------------ *
 * Troca de senha (obrigatória no primeiro acesso, ou voluntária)
 * ------------------------------------------------------------------ */

export function PasswordChange({
  forcada,
  onTrocada,
}: {
  forcada: boolean;
  onTrocada: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== confirma) {
      setErro('A confirmação não confere com a nova senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api('/auth/password', {
        method: 'PUT',
        body: { currentPassword: atual, newPassword: nova },
      });
      toast.ok('Senha atualizada. As outras sessões foram encerradas.');
      await onTrocada();
    } catch (err) {
      setErro(
        err instanceof ApiError && err.data.error === 'senha_atual_incorreta'
          ? 'A senha atual está incorreta.'
          : descreverErro(err),
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura
      titulo={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-5 text-accent" aria-hidden />
          Trocar senha
        </span>
      }
      sub={
        forcada
          ? 'A senha inicial veio por variável de ambiente e passou por log de deploy. Escolha uma nova antes de continuar.'
          : 'Trocar a senha encerra as outras sessões abertas.'
      }
      aviso={erro ? { tom: 'err', texto: erro } : null}
      onSubmit={submeter}
    >
      <Field label="Senha atual" htmlFor="atual">
        <Input
          id="atual"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
        />
      </Field>
      <Field label="Nova senha" hint={REGRA_SENHA} htmlFor="pc-nova">
        <Input
          id="pc-nova"
          type="password"
          autoComplete="new-password"
          required
          value={nova}
          onChange={(e) => setNova(e.target.value)}
        />
      </Field>
      <Field label="Confirme a nova senha" htmlFor="pc-confirma">
        <Input
          id="pc-confirma"
          type="password"
          autoComplete="new-password"
          required
          value={confirma}
          onChange={(e) => setConfirma(e.target.value)}
        />
      </Field>
      <Button type="submit" block loading={enviando}>
        Salvar nova senha
      </Button>
    </Moldura>
  );
}

export type { Me };
