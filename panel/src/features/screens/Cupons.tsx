import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Power, Tag, Ticket, Trash2 } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { brl, centavosDe, num, quando, reaisDe } from '@/lib/format';
import type {
  CouponKind,
  CouponRow,
  CouponUsageResponse,
  CouponsResponse,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, FieldGrid, Input, Select, ToggleRow } from '@/components/ui/form';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/metrics';
import { Badge, Callout, Empty, ErrorState, Loading } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/ui/table';
import { chaves, useAcao } from '../hooks';

/* ==========================================================================
   Cupons de desconto

   O comprador digita o cupom na landing page, mas o cupom só existe se ele
   foi criado aqui. Não há cupom automático, não há desconto por link e a
   página não decide valor nenhum: ela manda o código, o servidor devolve o
   preço. Isso é o que impede alguém de abrir o console e "se dar" 100%.

   Duas regras aparecem repetidas na tela porque as duas já geraram susto:

   1. **Nenhum cupom zera o pedido.** O piso é o mínimo do Pix configurado na
      aba Checkout. Um cupom de 100% resulta nesse mínimo, não em R$ 0,00 —
      Pix de valor zero não existe para gateway nenhum, e o pedido nasceria
      impossível de pagar. A pré-visualização de cada linha já mostra o valor
      real, para o dono não descobrir a regra depois de anunciar "de graça".

   2. **Uso gasto é uso que virou Pix, não venda.** `Usos` sobe quando a
      cobrança é criada; a tabela de desempenho lá embaixo conta o que foi
      pago. Um cupom com dez usos e duas vendas não é um cupom de sucesso.
   ========================================================================== */

const PERIODOS = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
];

interface Rascunho {
  code: string;
  kind: CouponKind;
  /** Texto cru do campo: "10" para percentual, "5,00" para valor fixo. */
  valor: string;
  active: boolean;
  /** Vazio = ilimitado. */
  maxUses: string;
  /** `datetime-local`, ou vazio. */
  startsAt: string;
  endsAt: string;
  note: string;
}

const RASCUNHO_NOVO: Rascunho = {
  code: '',
  kind: 'percent',
  valor: '10',
  active: true,
  maxUses: '',
  startsAt: '',
  endsAt: '',
  note: '',
};

/** ISO do servidor → o formato que o `<input type="datetime-local">` aceita. */
function paraCampoLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  /* Subtrai o fuso antes de cortar: `toISOString` devolve UTC, e sem isso um
     cupom marcado para as 9h apareceria como 12h no campo. */
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** O que o campo local tem → ISO em UTC, que é o que a rota valida. */
function paraIso(valor: string): string | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rascunhoDe(c: CouponRow): Rascunho {
  return {
    code: c.code,
    kind: c.kind,
    valor: c.kind === 'percent' ? String(c.value) : reaisDe(c.value),
    active: c.active,
    maxUses: c.maxUses === null ? '' : String(c.maxUses),
    startsAt: paraCampoLocal(c.startsAt),
    endsAt: paraCampoLocal(c.endsAt),
    note: c.note ?? '',
  };
}

function valorEmNumero(r: Rascunho): number {
  return r.kind === 'percent' ? Math.trunc(Number(r.valor.replace(',', '.')) || 0) : centavosDe(r.valor);
}

/** O corpo que as rotas de criar e alterar esperam. */
function corpoDe(r: Rascunho) {
  return {
    code: r.code.trim().toUpperCase(),
    kind: r.kind,
    value: valorEmNumero(r),
    active: r.active,
    maxUses: r.maxUses.trim() ? Math.trunc(Number(r.maxUses)) : null,
    startsAt: paraIso(r.startsAt),
    endsAt: paraIso(r.endsAt),
    note: r.note.trim() || null,
  };
}

/**
 * A mesma conta que o servidor faz, só para a pré-visualização enquanto o
 * dono digita.
 *
 * O número que vale continua sendo o do servidor: assim que o cupom é salvo,
 * a tabela mostra o `preview` que veio de lá. Esta função existe porque
 * esperar um salvamento para descobrir que 100% vira R$ 1,00 é tarde demais.
 */
function previsao(r: Rascunho, priceCents: number, pixMinCents: number) {
  const piso = Math.min(pixMinCents, priceCents);
  const valor = valorEmNumero(r);
  const pedido = r.kind === 'percent' ? Math.floor((priceCents * valor) / 100) : valor;
  const maximo = Math.max(0, priceCents - piso);
  const desconto = Math.max(0, Math.min(pedido, maximo));
  return { desconto, total: priceCents - desconto, limitado: pedido > maximo };
}

function problema(r: Rascunho): string | null {
  const codigo = r.code.trim();
  if (codigo.length < 3) return 'O código precisa de pelo menos 3 caracteres.';
  if (!/^[A-Za-z0-9_-]+$/.test(codigo)) return 'Use apenas letras, números, hífen e sublinhado.';
  const valor = valorEmNumero(r);
  if (valor < 1) return 'Informe um desconto maior que zero.';
  if (r.kind === 'percent' && valor > 100) return 'O percentual vai de 1 a 100.';
  if (r.maxUses.trim() && Math.trunc(Number(r.maxUses)) < 1) return 'O limite de usos, se preenchido, começa em 1.';
  if (r.startsAt && r.endsAt && new Date(r.startsAt) >= new Date(r.endsAt)) {
    return 'A data de início tem que ser antes da de fim.';
  }
  return null;
}

/** Vale hoje? Repete no navegador o que o servidor confere na hora de usar. */
function situacao(c: CouponRow): { label: string; tom: 'paid' | 'pending' | 'neutral' | 'danger' } {
  if (!c.active) return { label: 'desativado', tom: 'neutral' };
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return { label: 'esgotado', tom: 'danger' };
  const agora = Date.now();
  if (c.startsAt && new Date(c.startsAt).getTime() > agora) return { label: 'ainda não vale', tom: 'pending' };
  if (c.endsAt && new Date(c.endsAt).getTime() < agora) return { label: 'expirado', tom: 'neutral' };
  return { label: 'valendo', tom: 'paid' };
}

/* ------------------------------------------------------------------ *
 * Formulário — usado tanto para criar quanto para editar
 * ------------------------------------------------------------------ */

function FormularioCupom({
  rascunho,
  onChange,
  priceCents,
  pixMinCents,
  codigoTravado,
}: {
  rascunho: Rascunho;
  onChange: (r: Rascunho) => void;
  priceCents: number;
  pixMinCents: number;
  codigoTravado: boolean;
}) {
  const p = useMemo(() => previsao(rascunho, priceCents, pixMinCents), [rascunho, priceCents, pixMinCents]);
  const set = (mudanca: Partial<Rascunho>) => onChange({ ...rascunho, ...mudanca });

  return (
    <div className="grid gap-4">
      <FieldGrid>
        <Field
          label="Código"
          hint={
            codigoTravado
              ? 'Este cupom já foi usado — o código não muda mais.'
              : 'É o que a pessoa digita. Sem acento e sem espaço.'
          }
          htmlFor="cupom-code"
        >
          <Input
            id="cupom-code"
            autoFocus={!codigoTravado}
            disabled={codigoTravado}
            value={rascunho.code}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            placeholder="TESTE10"
            /* Maiúscula na hora: o servidor normaliza de qualquer jeito, e
               ver "teste10" aqui e "TESTE10" na lista confunde. */
            onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
          />
        </Field>

        <Field label="Tipo de desconto" htmlFor="cupom-kind">
          <Select
            id="cupom-kind"
            value={rascunho.kind}
            onChange={(e) => {
              const kind = e.target.value as CouponKind;
              /* Trocar de tipo sem trocar o número transformaria "10%" em
                 "R$ 0,10". Cada tipo recomeça com um padrão seu. */
              set({ kind, valor: kind === 'percent' ? '10' : reaisDe(Math.round(priceCents * 0.1)) });
            }}
          >
            <option value="percent">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </Select>
        </Field>
      </FieldGrid>

      <FieldGrid>
        <Field
          label={rascunho.kind === 'percent' ? 'Percentual de desconto' : 'Valor do desconto'}
          hint={rascunho.kind === 'percent' ? 'De 1 a 100.' : 'Em reais, como 5,00.'}
          htmlFor="cupom-valor"
        >
          <Input
            id="cupom-valor"
            inputMode="decimal"
            value={rascunho.valor}
            onChange={(e) => set({ valor: e.target.value })}
          />
        </Field>

        <Field
          label="Limite de usos"
          hint="Vazio = ilimitado. É o campo do cupom de teste: 1 uso, e ele se esgota sozinho."
          htmlFor="cupom-max"
        >
          <Input
            id="cupom-max"
            inputMode="numeric"
            placeholder="ilimitado"
            value={rascunho.maxUses}
            onChange={(e) => set({ maxUses: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
      </FieldGrid>

      <FieldGrid>
        <Field label="Começa a valer" hint="Vazio = vale desde já." htmlFor="cupom-inicio">
          <Input
            id="cupom-inicio"
            type="datetime-local"
            value={rascunho.startsAt}
            onChange={(e) => set({ startsAt: e.target.value })}
          />
        </Field>
        <Field label="Para de valer" hint="Vazio = não expira." htmlFor="cupom-fim">
          <Input
            id="cupom-fim"
            type="datetime-local"
            value={rascunho.endsAt}
            onChange={(e) => set({ endsAt: e.target.value })}
          />
        </Field>
      </FieldGrid>

      <Field label="Anotação" hint="Só para você. Ex.: “teste do Mercado Pago”." htmlFor="cupom-note">
        <Input
          id="cupom-note"
          maxLength={200}
          value={rascunho.note}
          onChange={(e) => set({ note: e.target.value })}
        />
      </Field>

      <ToggleRow
        label="Cupom ativo"
        hint="Desativado, ele para de funcionar na hora, sem perder o histórico."
        checked={rascunho.active}
        onChange={(v) => set({ active: v })}
      />

      <div className="rounded-md border border-line bg-bg p-4">
        <p className="text-2xs font-bold tracking-wider text-muted uppercase">Com este cupom o cliente paga</p>
        <p className="mt-1 text-lg font-bold">
          <span className="text-muted line-through">{brl(priceCents)}</span>{' '}
          <span className="text-accent">{brl(p.total)}</span>
        </p>
        <p className="mt-1 text-xs text-muted">Desconto de {brl(p.desconto)}.</p>
        {p.limitado ? (
          <p className="mt-2 text-xs text-warn">
            O desconto pedido era maior, mas parou no mínimo do Pix ({brl(Math.min(pixMinCents, priceCents))}).
            Cobrança de R$ 0,00 não existe para o gateway.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tela
 * ------------------------------------------------------------------ */

export function TelaCupons() {
  const [dias, setDias] = useState(30);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<CouponRow | null>(null);
  const [excluindo, setExcluindo] = useState<CouponRow | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_NOVO);

  const lista = useQuery({
    queryKey: chaves.coupons,
    queryFn: () => api<CouponsResponse>('/coupons'),
  });

  const uso = useQuery({
    queryKey: chaves.couponsUsage(dias),
    queryFn: () => api<CouponUsageResponse>(`/coupons/usage?days=${dias}`),
  });

  const criar = useAcao(() => api<CouponRow>('/coupons', { method: 'POST', body: corpoDe(rascunho) }), {
    invalidar: [chaves.coupons],
    sucesso: 'Cupom criado. Já dá para digitar na página.',
    onSuccess: () => {
      setCriando(false);
      setRascunho(RASCUNHO_NOVO);
    },
  });

  const alterar = useAcao(
    ({ id, corpo }: { id: string; corpo: ReturnType<typeof corpoDe> | { active: boolean } }) =>
      api<CouponRow>(`/coupons/${id}`, { method: 'PATCH', body: corpo }),
    {
      invalidar: [chaves.coupons],
      sucesso: 'Cupom atualizado.',
      onSuccess: () => setEditando(null),
    },
  );

  const remover = useAcao(
    (id: string) => api<{ ok: true; desativado: boolean }>(`/coupons/${id}`, { method: 'DELETE' }),
    {
      invalidar: [chaves.coupons],
      sucesso: (r) =>
        r.desativado
          ? 'O cupom já tinha sido usado, então foi desativado em vez de apagado — o histórico das vendas continua.'
          : 'Cupom excluído.',
      onSuccess: () => setExcluindo(null),
    },
  );

  if (lista.isPending) return <Loading />;
  if (lista.error) {
    if (ehSessaoExpirada(lista.error)) return null;
    return <ErrorState message={descreverErro(lista.error)} onRetry={() => void lista.refetch()} />;
  }

  const d = lista.data;
  const erroForm = problema(rascunho);

  return (
    <>
      {!d.couponsEnabled ? (
        <Callout tom="warn">
          O campo de cupom está <strong>escondido na landing page</strong>. Os cupons abaixo existem, mas
          ninguém consegue digitar um. Ligue <strong>“Aceitar cupom de desconto”</strong> na aba{' '}
          <a className="font-semibold text-accent underline underline-offset-4" href="#checkout">
            Checkout
          </a>
          .
        </Callout>
      ) : null}

      <Surface as="section" className="mb-5">
        <SurfaceHeader
          title="Cupons"
          icon={<Ticket />}
          hint={`O cliente digita o código no checkout. O preço de hoje é ${brl(d.priceCents)} e nenhum cupom baixa de ${brl(Math.min(d.pixMinCents, d.priceCents))} — o mínimo do Pix, configurado na aba Checkout.`}
          action={
            <Button
              onClick={() => {
                setRascunho(RASCUNHO_NOVO);
                setCriando(true);
              }}
            >
              <Ticket />
              Criar cupom
            </Button>
          }
        />

        {d.coupons.length === 0 ? (
          <Empty>
            Nenhum cupom ainda. Para testar uma compra de verdade sem dar o produto de graça, crie um com
            limite de 1 uso — ele cobra o mínimo do Pix e se esgota sozinho.
          </Empty>
        ) : (
          <Table sticky stackBelow="sm" caption="Cupons cadastrados">
            <THead>
              <TRow>
                <TH>Código</TH>
                <TH>Desconto</TH>
                <TH num>Cliente paga</TH>
                <TH num>Usos</TH>
                <TH>Situação</TH>
                <TH>Validade</TH>
                <TH>
                  <span className="sr-only">Ações</span>
                </TH>
              </TRow>
            </THead>
            <TBody>
              {d.coupons.map((c) => {
                const st = situacao(c);
                return (
                  <TRow key={c.id}>
                    <TD label="Código">
                      <span className="font-mono font-bold tracking-wide">{c.code}</span>
                      {c.note ? <span className="block text-2xs text-muted">{c.note}</span> : null}
                    </TD>
                    <TD label="Desconto">
                      {c.kind === 'percent' ? `${c.value}%` : brl(c.value)}
                      <span className="block text-2xs text-muted">− {brl(c.preview.discountCents)}</span>
                    </TD>
                    <TD num label="Cliente paga">
                      {brl(c.preview.amountCents)}
                      {c.preview.limitadoPeloMinimo ? (
                        <span className="block text-2xs text-warn">no mínimo do Pix</span>
                      ) : null}
                    </TD>
                    <TD num label="Usos">
                      {num(c.usedCount)}
                      <span className="block text-2xs text-muted">
                        {c.maxUses === null ? 'ilimitado' : `de ${num(c.maxUses)}`}
                      </span>
                    </TD>
                    <TD label="Situação">
                      <Badge tom={st.tom}>{st.label}</Badge>
                    </TD>
                    <TD muted label="Validade">
                      <span className="block text-2xs">
                        {c.startsAt ? `a partir de ${quando(c.startsAt)}` : 'vale desde já'}
                      </span>
                      <span className="block text-2xs">
                        {c.endsAt ? `até ${quando(c.endsAt)}` : 'sem prazo'}
                      </span>
                    </TD>
                    <TD label="Ações">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRascunho(rascunhoDe(c));
                            setEditando(c);
                          }}
                        >
                          <Pencil />
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={alterar.isPending}
                          onClick={() => alterar.mutate({ id: c.id, corpo: { active: !c.active } })}
                        >
                          <Power />
                          {c.active ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setExcluindo(c)}>
                          <Trash2 />
                          Excluir
                        </Button>
                      </div>
                    </TD>
                  </TRow>
                );
              })}
            </TBody>
          </Table>
        )}
      </Surface>

      {/* --------------------------------------------------- Desempenho --- */}
      <Surface as="section" className="mb-5">
        <SurfaceHeader
          title="O que cada cupom vendeu"
          hint="“Pedidos” são Pix gerados com o cupom; “pagos” são os que entraram. A diferença entre os dois é o que separa um cupom que atrai de um cupom que converte."
          action={<Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período" />}
        />
        {uso.isPending ? (
          <Loading label="Somando os pedidos…" />
        ) : uso.error ? (
          <ErrorState message={descreverErro(uso.error)} onRetry={() => void uso.refetch()} />
        ) : uso.data.items.length === 0 ? (
          <Empty>Nenhum pedido feito com cupom no período.</Empty>
        ) : (
          <Table sticky stackBelow="sm" caption="Vendas por cupom no período">
            <THead>
              <TRow>
                <TH>Cupom</TH>
                <TH num>Pedidos</TH>
                <TH num>Pagos</TH>
                <TH num>Receita</TH>
                <TH num>Desconto dado</TH>
              </TRow>
            </THead>
            <TBody>
              {uso.data.items.map((i) => (
                <TRow key={i.code}>
                  <TD label="Cupom">
                    <span className="font-mono font-bold tracking-wide">{i.code}</span>
                  </TD>
                  <TD num label="Pedidos">
                    {num(i.pedidos)}
                  </TD>
                  <TD num label="Pagos">
                    {num(i.pagos)}
                  </TD>
                  <TD num label="Receita">
                    {brl(i.receitaCents)}
                  </TD>
                  <TD num muted label="Desconto dado">
                    {brl(i.descontoCents)}
                  </TD>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Surface>

      {/* ------------------------------------------------------- Criar --- */}
      <Dialog open={criando} onOpenChange={setCriando}>
        <DialogContent
          title="Criar cupom"
          description="O código é digitado pelo cliente no checkout. Nada disso fica visível na página até alguém acertar o código."
        >
          <FormularioCupom
            rascunho={rascunho}
            onChange={setRascunho}
            priceCents={d.priceCents}
            pixMinCents={d.pixMinCents}
            codigoTravado={false}
          />
          {erroForm ? (
            <p className="mt-3 text-xs text-danger" role="alert">
              {erroForm}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
            <Button loading={criar.isPending} disabled={erroForm !== null} onClick={() => criar.mutate(undefined)}>
              Criar cupom
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------ Editar --- */}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando ? (
          <DialogContent
            title={`Editar ${editando.code}`}
            description="Mudanças valem para os próximos pedidos. Os que já foram feitos com este cupom não mudam."
          >
            <FormularioCupom
              rascunho={rascunho}
              onChange={setRascunho}
              priceCents={d.priceCents}
              pixMinCents={d.pixMinCents}
              codigoTravado={editando.usedCount > 0}
            />
            {erroForm ? (
              <p className="mt-3 text-xs text-danger" role="alert">
                {erroForm}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button
                loading={alterar.isPending}
                disabled={erroForm !== null}
                onClick={() => alterar.mutate({ id: editando.id, corpo: corpoDe(rascunho) })}
              >
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {/* ----------------------------------------------------- Excluir --- */}
      <Dialog open={excluindo !== null} onOpenChange={(v) => !v && setExcluindo(null)}>
        {excluindo ? (
          <DialogContent
            title={`Excluir ${excluindo.code}?`}
            description={
              excluindo.usedCount > 0
                ? 'Este cupom já foi usado, então ele será desativado em vez de apagado.'
                : 'Este cupom nunca foi usado e será apagado de vez.'
            }
          >
            <p className="text-sm text-ink-2">
              {excluindo.usedCount > 0 ? (
                <>
                  Apagar faria as <strong>{num(excluindo.usedCount)}</strong> vendas feitas com{' '}
                  <strong>{excluindo.code}</strong> apontarem para um código que não existe mais. Ele para de
                  funcionar na hora e o histórico continua de pé.
                </>
              ) : (
                <>
                  <strong>{excluindo.code}</strong> deixa de existir. Não tem desfazer.
                </>
              )}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setExcluindo(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={remover.isPending} onClick={() => remover.mutate(excluindo.id)}>
                {excluindo.usedCount > 0 ? 'Desativar cupom' : 'Excluir cupom'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <p className="mt-2 flex items-start gap-2 text-2xs text-muted">
        <Tag className="mt-px size-3.5 shrink-0" aria-hidden />
        Cada cupom aplicado ou recusado na página vira um evento no funil — dá para ver na tela de Eventos
        quantas pessoas tentaram um código que você nunca criou.
      </p>
    </>
  );
}
