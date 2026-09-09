import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ehSessaoExpirada, onSessaoPerdida } from '@/lib/api';
import { limparHash, useRota } from '@/lib/router';
import type { Me } from '@/lib/types';
import { AppShell } from '@/components/shell/AppShell';
import { podeVer, telaPorId } from '@/components/shell/screens';
import { ErrorState, Loading } from '@/components/ui/layout';
import { Forgot, Login, PasswordChange, SetPassword } from '@/features/auth/AuthViews';
import { TELA_COMPONENTES } from '@/features/registry';

type Fase =
  | { nome: 'carregando' }
  | { nome: 'login'; mensagem?: string; tom?: 'ok' | 'err' }
  | { nome: 'forgot'; email: string }
  | { nome: 'trocar-senha'; forcada: boolean }
  | { nome: 'painel' };

export function App() {
  const rota = useRota();
  const qc = useQueryClient();
  const [fase, setFase] = useState<Fase>({ nome: 'carregando' });
  const [me, setMe] = useState<Me | null>(null);
  const [devLogin, setDevLogin] = useState(false);

  /**
   * Boot.
   *
   * A ordem importa: `mustChangePassword` é conferido ANTES de qualquer
   * carga de tela, senão o painel montaria por trás de uma senha que o
   * servidor considera provisória.
   */
  const boot = useCallback(async () => {
    setFase({ nome: 'carregando' });
    // Decorativo: quem realmente barra o atalho em produção é o servidor
    // (a rota some com 404 quando NODE_ENV=production).
    api<{ devLoginAvailable: boolean }>('/auth/status')
      .then((s) => setDevLogin(s.devLoginAvailable))
      .catch(() => setDevLogin(false));
    try {
      const eu = await api<Me>('/auth/me');
      setMe(eu);
      if (eu.mustChangePassword) {
        setFase({ nome: 'trocar-senha', forcada: true });
        return;
      }
      setFase({ nome: 'painel' });
    } catch (err) {
      setMe(null);
      // `sessao_expirada` já levou para o login por outro caminho (o
      // ouvinte de sessão perdida) — repintar aqui apagaria o que o dono
      // tivesse digitado no formulário de login.
      if (!ehSessaoExpirada(err)) setFase({ nome: 'login' });
    }
  }, []);

  useEffect(() => {
    // Link de e-mail (#reset= / #convite=) não faz boot: a pessoa nem tem
    // sessão ainda.
    if (rota.tipo === 'token') {
      setFase({ nome: 'carregando' });
      return;
    }
    void boot();
    // Só no primeiro carregamento: a troca de tela não refaz o boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Quando o refresh falha, todo cache de tela precisa ir embora com ele. */
  useEffect(
    () =>
      onSessaoPerdida(() => {
        setMe(null);
        qc.clear();
        setFase({ nome: 'login', mensagem: 'Sua sessão expirou. Entre novamente.' });
      }),
    [qc],
  );

  async function sair() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
    qc.clear();
    setFase({ nome: 'login', mensagem: 'Você saiu do painel.' });
  }

  /* ------------------------------------------------------------------ *
   * Links que chegam por e-mail
   * ------------------------------------------------------------------ */
  if (rota.tipo === 'token') {
    return (
      <SetPassword
        token={rota.token}
        kind={rota.kind}
        onPronto={(mensagem) => {
          limparHash();
          setFase({ nome: 'login', mensagem, tom: 'ok' });
        }}
        onDesistir={() => {
          limparHash();
          setFase(
            rota.kind === 'convite'
              ? { nome: 'login', mensagem: 'Se o convite expirou, peça a um administrador para reenviar.' }
              : { nome: 'forgot', email: '' },
          );
        }}
      />
    );
  }

  switch (fase.nome) {
    case 'carregando':
      return <Loading label="Abrindo o painel…" />;

    case 'login':
      return (
        <Login
          mensagem={fase.mensagem}
          tom={fase.tom ?? 'err'}
          devLoginAvailable={devLogin}
          onEntrou={(res) => {
            if (res.mustChangePassword) setFase({ nome: 'trocar-senha', forcada: true });
            else void boot();
          }}
          onEsqueci={(email) => setFase({ nome: 'forgot', email })}
        />
      );

    case 'forgot':
      return <Forgot prefill={fase.email} onVoltar={() => setFase({ nome: 'login' })} />;

    case 'trocar-senha':
      return <PasswordChange forcada={fase.forcada} onTrocada={boot} />;

    case 'painel': {
      const id = rota.tipo === 'tela' ? rota.id : 'dashboard';
      const tela = telaPorId(id);
      const Componente = tela ? TELA_COMPONENTES[tela.id] : undefined;

      return (
        <AppShell telaAtual={tela?.id ?? 'dashboard'} me={me} onSair={sair}>
          {!tela || !Componente ? (
            <ErrorState
              message={`A tela "${id}" não existe. Use o menu para escolher uma.`}
              onRetry={() => {
                location.hash = 'dashboard';
              }}
            />
          ) : !podeVer(tela, me?.role) ? (
            <ErrorState message="Esta tela é só para administradores. Fale com quem administra o painel." />
          ) : (
            <Componente me={me} />
          )}
        </AppShell>
      );
    }
  }
}
