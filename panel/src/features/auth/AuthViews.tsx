import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, descreverErro, ApiError } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Callout, type Tom } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';

/* ==========================================================================
   Telas de autenticação: login, esqueci a senha, criar/redefinir senha e a
   troca obrigatória. Comportamento portado de `admin/js/auth-views.js`.

   O que estas telas propositalmente NÃO fazem: guardar e-mail, senha ou
   qualquer token em `localStorage`. A sessão vive só nos cookies `httpOnly`
   que o servidor escreve.
   ========================================================================== */

function Moldura({
  titulo,
  sub,
  aviso,
  children,
  rodape,
  onSubmit,
}: {
  titulo: React.ReactNode;
  sub: string;
  aviso?: { tom: Tom; texto: string } | null;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="grid min-h-svh place-items-center p-5">
      <form
        onSubmit={onSubmit}
        className="w-[min(100%,24rem)] rounded-lg border border-line bg-surface p-6 shadow-float sm:p-8"
      >
        <div className="mb-1 text-xl font-extrabold tracking-tight">{titulo}</div>
        <p className="mb-6 text-sm text-muted">{sub}</p>
        {aviso ? <Callout tom={aviso.tom}>{aviso.texto}</Callout> : null}
        <div className="grid gap-4">{children}</div>
        {rodape ? <div className="mt-5 text-center">{rodape}</div> : null}
      </form>
    </div>
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
      titulo={Marca}
      sub="Painel administrativo"
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
          autoFocus
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
        Entrar
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
