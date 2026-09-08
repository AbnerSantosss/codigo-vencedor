import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { quando } from '@/lib/format';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, Input } from '@/components/ui/form';
import { Actions, Callout, Card, CardTitle } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';

export function TelaConta({ me }: { me: Me | null }) {
  const toast = useToast();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function trocar() {
    if (nova !== confirma) {
      toast.erro('A confirmação não confere com a nova senha.');
      return;
    }
    setEnviando(true);
    try {
      await api('/auth/password', { method: 'PUT', body: { currentPassword: atual, newPassword: nova } });
      setAtual('');
      setNova('');
      setConfirma('');
      toast.ok('Senha atualizada. As outras sessões foram encerradas.');
    } catch (err) {
      toast.erro(
        err instanceof ApiError && err.data.error === 'senha_atual_incorreta'
          ? 'A senha atual está incorreta.'
          : err instanceof ApiError
            ? (err.data.message ?? err.data.error ?? 'Não foi possível trocar a senha.')
            : 'Não foi possível trocar a senha.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Card>
        <CardTitle
          title="Seus dados"
          hint="O e-mail é o seu login. Para trocar, peça a um administrador que convide o novo endereço."
        />
        <FieldGrid>
          <Field label="E-mail">
            <Input value={me?.email ?? ''} readOnly />
          </Field>
          <Field label="Papel">
            <Input value={me?.role === 'owner' ? 'Administrador' : 'Usuário'} readOnly />
          </Field>
          <Field label="Último acesso">
            <Input value={quando(me?.lastLoginAt)} readOnly />
          </Field>
        </FieldGrid>
      </Card>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void trocar();
          }}
        >
          <CardTitle
            title="Trocar senha"
            hint="Trocar a senha encerra as outras sessões abertas — inclusive em outros aparelhos."
          />
          <FieldGrid>
            <Field label="Senha atual" htmlFor="c-atual">
              <Input
                id="c-atual"
                type="password"
                autoComplete="current-password"
                required
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
              />
            </Field>
            <Field
              label="Nova senha"
              hint="Mínimo de 12 caracteres, com maiúscula, minúscula e número."
              htmlFor="c-nova"
            >
              <Input
                id="c-nova"
                type="password"
                autoComplete="new-password"
                required
                value={nova}
                onChange={(e) => setNova(e.target.value)}
              />
            </Field>
            <Field label="Confirme a nova senha" htmlFor="c-confirma">
              <Input
                id="c-confirma"
                type="password"
                autoComplete="new-password"
                required
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
              />
            </Field>
          </FieldGrid>

          <Callout tom="info" className="mt-4 mb-0">
            A senha é guardada como hash bcrypt. Nem o painel nem o suporte conseguem ver a sua — se
            esquecer, o caminho é "esqueci minha senha" na tela de login.
          </Callout>

          <Actions>
            <Button type="submit" loading={enviando}>
              Salvar nova senha
            </Button>
          </Actions>
        </form>
      </Card>
    </>
  );
}
