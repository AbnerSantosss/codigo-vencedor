import { useState } from 'react';
import type { Links } from '@/lib/types';
import { Field, FieldGrid, Input } from '@/components/ui/form';
import { Callout, GroupTitle } from '@/components/ui/layout';
import { ComConfig, CardForm } from '../SecaoConfig';
import { useSalvarConfig } from '../hooks';

const REDES: [keyof Links['social'], string, string][] = [
  ['instagram', 'Instagram', 'https://instagram.com/seuperfil'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@seuperfil'],
  ['kwai', 'Kwai', 'https://kwai.com/@seuperfil'],
  ['x', 'X (Twitter)', 'https://x.com/seuperfil'],
];

export function TelaLinks() {
  return <ComConfig>{(cfg) => <Formulario key={JSON.stringify(cfg.links)} inicial={cfg.links} />}</ComConfig>;
}

function Formulario({ inicial }: { inicial: Links }) {
  const salvar = useSalvarConfig();
  const [numero, setNumero] = useState(inicial.whatsapp.number);
  const [mensagem, setMensagem] = useState(inicial.whatsapp.message);
  const [social, setSocial] = useState({ ...inicial.social });

  const digitos = numero.replace(/\D/g, '');
  const numeroCurto = digitos.length > 0 && digitos.length < 12;

  return (
    <CardForm
      title="Links e redes sociais"
      hint="Campo vazio some da página em vez de virar link morto — era assim que os quatro ícones do rodapé estavam."
      salvando={salvar.isPending}
      onSubmit={() =>
        salvar.mutate({
          links: {
            whatsapp: { number: digitos, message: mensagem },
            social: Object.fromEntries(
              Object.entries(social).map(([k, v]) => [k, v.trim()]),
            ) as Links['social'],
          },
        })
      }
    >
      {!digitos ? (
        <Callout tom="warn">
          Sem WhatsApp cadastrado, a variável <code>{'{{suporte}}'}</code> dos e-mails cai no endereço
          do remetente — o cliente responde para a caixa de envio e ninguém lê.
        </Callout>
      ) : null}

      <div>
        <GroupTitle>WhatsApp</GroupTitle>
        <div className="grid gap-4">
          <Field
            label="Número com DDI e DDD"
            hint="Só dígitos. Ex.: 5511987654321 para (11) 98765-4321."
            error={numeroCurto ? 'Faltam dígitos: precisa de DDI + DDD + número.' : null}
            htmlFor="wa"
          >
            <Input
              id="wa"
              inputMode="numeric"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              aria-invalid={numeroCurto || undefined}
              placeholder="5511987654321"
            />
          </Field>
          <Field label="Mensagem que já vem digitada" htmlFor="wa-msg">
            <Input
              id="wa-msg"
              maxLength={300}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div>
        <GroupTitle>Perfis do rodapé</GroupTitle>
        <FieldGrid>
          {REDES.map(([chave, label, exemplo]) => (
            <Field key={chave} label={label} htmlFor={`rede-${chave}`}>
              <Input
                id={`rede-${chave}`}
                type="url"
                inputMode="url"
                placeholder={exemplo}
                value={social[chave]}
                onChange={(e) => setSocial((s) => ({ ...s, [chave]: e.target.value }))}
              />
            </Field>
          ))}
        </FieldGrid>
      </div>
    </CardForm>
  );
}
