import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Scarcity, SocialProofItem } from '@/lib/types';
import { Field, FieldGrid, Input, Select, ToggleRow } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Callout, Card, CardTitle, Divider, GroupTitle } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';
import { ComConfig, CardForm } from '../SecaoConfig';
import { useSalvarConfig } from '../hooks';

/**
 * Escassez.
 *
 * O aviso de compra recente é digitado à mão de propósito: ele afirma ao
 * visitante que uma compra acabou de acontecer. Com nome inventado isso é
 * publicidade enganosa (art. 37 do CDC) e reprova anúncio na Meta — então
 * não existe gerador de nome aqui, e a lista começa vazia.
 */
export function TelaEscassez() {
  return (
    <ComConfig>{(cfg) => <Formulario key={JSON.stringify(cfg.scarcity)} inicial={cfg.scarcity} />}</ComConfig>
  );
}

/** `datetime-local` quer "AAAA-MM-DDTHH:MM" no fuso local, não em UTC. */
function paraCampoLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AvisoLinha({
  item,
  onChange,
  onRemover,
  indice,
}: {
  item: SocialProofItem;
  onChange: (i: SocialProofItem) => void;
  onRemover: () => void;
  indice: number;
}) {
  const incompleto = !item.name.trim() || !item.product.trim();
  return (
    <div className="rounded-md border border-line bg-bg p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-2xs font-bold tracking-wider text-muted uppercase">Aviso {indice + 1}</span>
        <Button variant="danger" size="sm" onClick={onRemover}>
          <Trash2 />
          Remover
        </Button>
      </div>
      <FieldGrid>
        <Field label="Primeiro nome" error={incompleto && !item.name.trim() ? 'Obrigatório' : null}>
          <Input
            placeholder="Adriano"
            maxLength={60}
            value={item.name}
            onChange={(e) => onChange({ ...item, name: e.target.value })}
          />
        </Field>
        <Field label="Cidade" hint="Opcional">
          <Input
            placeholder="Goiânia"
            maxLength={60}
            value={item.city}
            onChange={(e) => onChange({ ...item, city: e.target.value })}
          />
        </Field>
        <Field label="O que comprou" error={incompleto && !item.product.trim() ? 'Obrigatório' : null}>
          <Input
            placeholder="Maiores Odds"
            maxLength={60}
            value={item.product}
            onChange={(e) => onChange({ ...item, product: e.target.value })}
          />
        </Field>
        <Field label="Há quantos minutos" hint="0 esconde o tempo">
          <Input
            inputMode="numeric"
            value={String(item.minutesAgo)}
            onChange={(e) => onChange({ ...item, minutesAgo: Number(e.target.value.replace(/\D/g, '')) || 0 })}
          />
        </Field>
      </FieldGrid>
      {incompleto ? (
        <p className="mt-2 text-2xs text-muted">
          Sem nome ou sem produto este aviso é descartado ao salvar, em vez de travar o formulário.
        </p>
      ) : null}
    </div>
  );
}

function Formulario({ inicial }: { inicial: Scarcity }) {
  const salvar = useSalvarConfig();
  const toast = useToast();

  const [cd, setCd] = useState(inicial.countdown);
  const [cdEnds, setCdEnds] = useState(paraCampoLocal(inicial.countdown.endsAt));
  const [spots, setSpots] = useState(inicial.spots);
  const [buyers, setBuyers] = useState(inicial.buyers);
  const [bar, setBar] = useState(inicial.bar.enabled);
  const [sp, setSp] = useState(inicial.socialProof);

  function submeter() {
    salvar.mutate({
      scarcity: {
        countdown: {
          enabled: cd.enabled,
          mode: cd.mode,
          minutes: cd.minutes || 15,
          endsAt: cd.mode === 'campaign' && cdEnds ? new Date(cdEnds).toISOString() : null,
        },
        spots,
        buyers,
        bar: { enabled: bar },
        socialProof: {
          enabled: sp.enabled,
          intervalSec: sp.intervalSec || 9,
          // Linha pela metade é descartada, não é erro de validação: quem
          // clicou em "adicionar" e mudou de ideia não fica travado no salvar.
          items: sp.items.filter((i) => i.name.trim() && i.product.trim()),
        },
      },
    });
  }

  const contadorFalso = cd.enabled && cd.mode === 'per_visitor';
  const campanhaSemData = cd.enabled && cd.mode === 'campaign' && !cdEnds;

  return (
    <>
      <CardForm
        title="Blocos de escassez"
        hint="Cada bloco liga e desliga sozinho. Nada aqui depende de outro."
        salvando={salvar.isPending}
        onSubmit={submeter}
      >
        {contadorFalso ? (
          <Callout tom="warn">
            No modo <strong>por visitante</strong> o prazo reinicia para cada pessoa e a oferta não
            termina de fato. No Brasil, prazo ou vaga inventados são o que o art. 37 do CDC trata
            como publicidade enganosa — o modo <strong>campanha</strong> e as opções "de verdade"
            usam dado real.
          </Callout>
        ) : null}

        <div>
          <GroupTitle>Contador</GroupTitle>
          <div className="grid gap-4">
            <ToggleRow
              label="Contador regressivo"
              hint='A tarja "OFERTA TERMINA EM" e a barra do checkout.'
              checked={cd.enabled}
              onChange={(v) => setCd({ ...cd, enabled: v })}
            />
            {cd.enabled ? (
              <FieldGrid>
                <Field label="Como o contador funciona">
                  <Select
                    value={cd.mode}
                    onChange={(e) => setCd({ ...cd, mode: e.target.value as Scarcity['countdown']['mode'] })}
                  >
                    <option value="per_visitor">Por visitante — cada pessoa vê o próprio relógio</option>
                    <option value="campaign">Campanha — uma data e hora fim iguais para todos</option>
                  </Select>
                </Field>
                {cd.mode === 'per_visitor' ? (
                  <Field label="Minutos por visitante">
                    <Input
                      inputMode="numeric"
                      value={String(cd.minutes)}
                      onChange={(e) => setCd({ ...cd, minutes: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                    />
                  </Field>
                ) : (
                  <Field
                    label="Termina em"
                    error={campanhaSemData ? 'Sem data, a campanha volta para o modo por visitante.' : null}
                  >
                    <Input
                      type="datetime-local"
                      value={cdEnds}
                      onChange={(e) => setCdEnds(e.target.value)}
                      aria-invalid={campanhaSemData || undefined}
                    />
                  </Field>
                )}
              </FieldGrid>
            ) : null}
          </div>
        </div>

        <Divider />

        <div>
          <GroupTitle>Vagas</GroupTitle>
          <div className="grid gap-4">
            <ToggleRow
              label="Vagas restantes"
              checked={spots.enabled}
              onChange={(v) => setSpots({ ...spots, enabled: v })}
            />
            {spots.enabled ? (
              <FieldGrid>
                <Field label="Origem do número de vagas">
                  <Select
                    value={spots.mode}
                    onChange={(e) => setSpots({ ...spots, mode: e.target.value as Scarcity['spots']['mode'] })}
                  >
                    <option value="manual">Número fixo que eu escolho</option>
                    <option value="from_sales">Descontar as vendas pagas do total</option>
                  </Select>
                </Field>
                <Field
                  label={spots.mode === 'from_sales' ? 'Total de vagas da oferta' : 'Vagas exibidas'}
                  hint={spots.mode === 'from_sales' ? 'A página mostra este total menos os pedidos pagos.' : undefined}
                >
                  <Input
                    inputMode="numeric"
                    value={String(spots.value)}
                    onChange={(e) => setSpots({ ...spots, value: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  />
                </Field>
              </FieldGrid>
            ) : null}
          </div>
        </div>

        <Divider />

        <div>
          <GroupTitle>Compradores e barra</GroupTitle>
          <div className="grid gap-4">
            <ToggleRow
              label="Compradores nas últimas 24h"
              hint='Sem efeito hoje: o texto "X pessoas garantiram o acesso" saiu da página. Quem faz esse papel agora é o aviso de compra recente, aqui embaixo.'
              checked={buyers.enabled}
              onChange={(v) => setBuyers({ ...buyers, enabled: v })}
            />
            {buyers.enabled ? (
              <FieldGrid>
                <Field label="Origem do número de compradores">
                  <Select
                    value={buyers.mode}
                    onChange={(e) => setBuyers({ ...buyers, mode: e.target.value as Scarcity['buyers']['mode'] })}
                  >
                    <option value="manual">Número fixo que eu escolho</option>
                    <option value="from_sales">Contar os pedidos pagos de verdade nas últimas 24h</option>
                  </Select>
                </Field>
                {buyers.mode === 'manual' ? (
                  <Field label="Compradores exibidos">
                    <Input
                      inputMode="numeric"
                      value={String(buyers.value)}
                      onChange={(e) => setBuyers({ ...buyers, value: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                    />
                  </Field>
                ) : null}
              </FieldGrid>
            ) : null}

            <ToggleRow
              label="Barra amarela sobre o checkout"
              hint="Sem efeito hoje: esta barra foi removida da página. As contagens que existem são a tarja no card de preço e a faixa de lançamento no checkout — as duas leem este mesmo prazo, então nunca divergem."
              checked={bar}
              onChange={setBar}
            />
          </div>
        </div>
      </CardForm>

      {/* ------------------------------------------------------------- *
          Aviso de compra recente — cartão próprio, porque é o bloco que
          o dono ainda precisa preencher e some no meio dos outros sete.
          ------------------------------------------------------------- */}
      <Card>
        <CardTitle
          title="Aviso de compra recente"
          hint='Um selo rotativo no canto da página: "Adriano · Goiânia acabou de adquirir Maiores Odds".'
        />

        <Callout tom="warn">
          Cadastre aqui <strong>só quem comprou de verdade</strong>. Este aviso afirma ao visitante que
          uma compra acabou de acontecer: com nome inventado ele é publicidade enganosa (art. 37 do
          CDC) e é motivo de reprovação de anúncio na Meta. Sem nenhum aviso cadastrado, ou com o
          bloco desligado, a landing page não exibe nada.
        </Callout>

        <div className="grid gap-4">
          <ToggleRow
            label="Aviso de compra recente"
            checked={sp.enabled}
            onChange={(v) => setSp({ ...sp, enabled: v })}
          />

          {sp.enabled ? (
            <>
              {sp.items.length >= 2 ? (
                <FieldGrid>
                  <Field label="Segundos entre um aviso e o próximo">
                    <Input
                      inputMode="numeric"
                      value={String(sp.intervalSec)}
                      onChange={(e) =>
                        setSp({ ...sp, intervalSec: Number(e.target.value.replace(/\D/g, '')) || 0 })
                      }
                    />
                  </Field>
                </FieldGrid>
              ) : null}

              {sp.items.length === 0 ? (
                <p className="text-sm text-muted">
                  Nenhum aviso cadastrado — a landing page não vai exibir nada. Use "adicionar aviso".
                </p>
              ) : (
                <div className="grid gap-3">
                  {sp.items.map((item, i) => (
                    <AvisoLinha
                      key={i}
                      indice={i}
                      item={item}
                      onChange={(novo) =>
                        setSp({ ...sp, items: sp.items.map((x, j) => (j === i ? novo : x)) })
                      }
                      onRemover={() => setSp({ ...sp, items: sp.items.filter((_, j) => j !== i) })}
                    />
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (sp.items.length >= 20) {
                      toast.erro('Máximo de 20 avisos.');
                      return;
                    }
                    setSp({ ...sp, items: [...sp.items, { name: '', city: '', product: '', minutesAgo: 0 }] });
                  }}
                >
                  <Plus />
                  Adicionar aviso
                </Button>
                <span className="text-2xs text-muted">{sp.items.length} de 20</span>
              </div>
            </>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button loading={salvar.isPending} onClick={submeter}>
              Salvar escassez e avisos
            </Button>
            <span className="text-2xs text-muted">
              Este botão salva a tela inteira — contador, vagas, compradores e avisos.
            </span>
          </div>
        </div>
      </Card>
    </>
  );
}
