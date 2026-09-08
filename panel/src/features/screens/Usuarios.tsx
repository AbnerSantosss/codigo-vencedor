import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MailPlus, RefreshCw, Trash2 } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { quando } from '@/lib/format';
import type { Role, UserRow, UsersResponse, UserStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, Input, Select } from '@/components/ui/form';
import {
  Badge,
  Callout,
  Card,
  CardTitle,
  ErrorState,
  Loading,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { chaves, useAcao } from '../hooks';

/* ==========================================================================
   Usuários do painel

   Dois papéis: `owner` (administrador — mexe em usuários, gateway e
   segredos) e `editor` (usuário — conteúdo, aparência, escassez, links e as
   métricas). Esconder a tela do editor é conveniência; a regra de verdade é
   o `requireOwner` no servidor, que responde 403 mesmo se alguém chamar a
   rota direto.

   Convite nunca manda senha: a conta nasce com uma senha aleatória que
   ninguém conhece e um link de uso único para a pessoa criar a dela.
   ========================================================================== */

const STATUS: Record<UserStatus, { label: string; tom: 'paid' | 'pending' | 'neutral' | 'danger' }> = {
  ativo: { label: 'ativo', tom: 'paid' },
  convite_enviado: { label: 'convite enviado', tom: 'pending' },
  convite_expirado: { label: 'convite expirado', tom: 'neutral' },
  bloqueado: { label: 'bloqueado', tom: 'danger' },
};

export function TelaUsuarios() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.users,
    queryFn: () => api<UsersResponse>('/users'),
  });

  const [convite, setConvite] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Role>('editor');
  const [excluir, setExcluir] = useState<UserRow | null>(null);

  const convidar = useAcao(
    () =>
      api<{ ok: true; email: { ok: boolean; error: string | null } }>('/users/invite', {
        method: 'POST',
        body: { name: nome.trim(), email: email.trim(), role: papel },
      }),
    {
      invalidar: [chaves.users],
      sucesso: (res) =>
        res.email.ok
          ? 'Convite enviado. A pessoa recebe um link para criar a senha.'
          : 'Usuário criado, mas o e-mail do convite falhou — use "reenviar convite".',
      onSuccess: () => {
        setConvite(false);
        setNome('');
        setEmail('');
        setPapel('editor');
      },
    },
  );

  const reenviar = useAcao((id: string) => api(`/users/${id}/resend-invite`, { method: 'POST' }), {
    sucesso: 'Convite reenviado.',
    invalidar: [chaves.users],
  });

  const trocarPapel = useAcao(
    ({ id, role }: { id: string; role: Role }) => api(`/users/${id}/role`, { method: 'PUT', body: { role } }),
    { sucesso: 'Papel alterado. As sessões dessa pessoa foram encerradas.', invalidar: [chaves.users] },
  );

  const remover = useAcao((id: string) => api(`/users/${id}`, { method: 'DELETE' }), {
    sucesso: 'Usuário excluído.',
    invalidar: [chaves.users],
    onSuccess: () => setExcluir(null),
  });

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }

  const donos = data.users.filter((u) => u.role === 'owner').length;

  return (
    <>
      <Card wide>
        <CardTitle
          title="Quem tem acesso ao painel"
          hint="Administrador mexe em tudo, inclusive gateway, segredos e usuários. Usuário cuida de conteúdo, aparência, escassez, links e vê as métricas."
          action={
            <Button onClick={() => setConvite(true)}>
              <MailPlus />
              Convidar
            </Button>
          }
        />

        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Pessoa</Th>
                <Th>Papel</Th>
                <Th>Status</Th>
                <Th>Último acesso</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const eu = u.id === data.me;
                const st = STATUS[u.status];
                const ultimoDono = u.role === 'owner' && donos <= 1;
                return (
                  <tr key={u.id}>
                    <Td>
                      {u.name ?? '—'}
                      {eu ? <span className="ml-1.5 text-2xs text-accent">(você)</span> : null}
                      <span className="block text-2xs text-muted">{u.email}</span>
                    </Td>
                    <Td>
                      <Select
                        aria-label={`Papel de ${u.email}`}
                        className="min-h-10 w-auto min-w-36 px-2 py-1 text-xs"
                        value={u.role}
                        disabled={ultimoDono || trocarPapel.isPending}
                        onChange={(e) => trocarPapel.mutate({ id: u.id, role: e.target.value as Role })}
                      >
                        <option value="owner">Administrador</option>
                        <option value="editor">Usuário</option>
                      </Select>
                    </Td>
                    <Td>
                      <Badge tom={st.tom}>{st.label}</Badge>
                      {u.status === 'convite_enviado' && u.inviteExpiresAt ? (
                        <span className="block text-2xs whitespace-normal text-muted">
                          vence {quando(u.inviteExpiresAt)}
                        </span>
                      ) : null}
                    </Td>
                    <Td muted>{quando(u.lastLoginAt)}</Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {!u.lastLoginAt ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={reenviar.isPending}
                            onClick={() => reenviar.mutate(u.id)}
                          >
                            <RefreshCw />
                            Reenviar
                          </Button>
                        ) : null}
                        {!eu ? (
                          <Button variant="danger" size="sm" disabled={ultimoDono} onClick={() => setExcluir(u)}>
                            <Trash2 />
                            Excluir
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>

        {donos <= 1 ? (
          <p className="mt-4 text-2xs text-muted">
            Só existe um administrador — por isso ele não pode ser rebaixado nem excluído. Promova outra
            pessoa antes, se precisar.
          </p>
        ) : null}
      </Card>

      {/* ------------------------------------------------------ Convite --- */}
      <Dialog open={convite} onOpenChange={setConvite}>
        <DialogContent
          title="Convidar alguém para o painel"
          description="A pessoa recebe um e-mail com um link de uso único, válido por 48 horas, para criar a própria senha. Nenhuma senha é enviada por e-mail."
        >
          <div className="grid gap-4">
            <FieldGrid>
              <Field label="Nome">
                <Input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
              </Field>
              <Field label="E-mail">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
              </Field>
            </FieldGrid>
            <Field
              label="Papel"
              hint="Administrador enxerga gateway, credenciais e usuários. Na dúvida, escolha Usuário."
            >
              <Select value={papel} onChange={(e) => setPapel(e.target.value as Role)}>
                <option value="editor">Usuário</option>
                <option value="owner">Administrador</option>
              </Select>
            </Field>
            {papel === 'owner' ? (
              <Callout tom="warn">
                Administrador pode ler o status das credenciais, trocar o gateway e excluir usuários.
                Dê esse papel só para quem cuida do negócio com você.
              </Callout>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConvite(false)}>
              Cancelar
            </Button>
            <Button
              loading={convidar.isPending}
              disabled={nome.trim().length < 2 || !email.includes('@')}
              onClick={() => convidar.mutate(undefined)}
            >
              Enviar convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------ Excluir --- */}
      <Dialog open={excluir !== null} onOpenChange={(v) => !v && setExcluir(null)}>
        {excluir ? (
          <DialogContent
            title="Excluir este acesso?"
            description="A conta, as sessões abertas e os convites pendentes dessa pessoa são apagados. Não tem desfazer."
          >
            <p className="text-sm text-ink-2">
              <strong>{excluir.name ?? excluir.email}</strong> perde o acesso ao painel imediatamente.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setExcluir(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={remover.isPending} onClick={() => remover.mutate(excluir.id)}>
                Excluir o acesso
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
