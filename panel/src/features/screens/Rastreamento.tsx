import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import type { MetaTestResponse, Tracking, TrackingResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldGrid,
  Input,
  SecretInput,
  ToggleRow,
  coletarSecrets,
  secretVazio,
  type SecretState,
} from '@/components/ui/form';
import { Actions, Callout, Card, CardTitle, ErrorState, GroupTitle, Loading } from '@/components/ui/layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { chaves, useAcao } from '../hooks';

/**
 * Rastreamento.
 *
 * As três abas separam o que antes era uma página de rolagem só: a Meta (que
 * dispara pelo servidor), o GTM (o único identificador que chega ao HTML) e
 * as plataformas que ficam guardadas esperando os IDs.
 */
export function TelaRastreamento() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: chaves.tracking,
    queryFn: () => api<TrackingResponse>('/tracking'),
  });

  if (isPending) return <Loading />;
  if (error) {
    if (ehSessaoExpirada(error)) return null;
    return <ErrorState message={descreverErro(error)} onRetry={() => void refetch()} />;
  }
  return <Formulario key={JSON.stringify(data)} inicial={data} />;
}

function Formulario({ inicial }: { inicial: TrackingResponse }) {
  const [t, setT] = useState<Tracking>(inicial.tracking);
  const [segredos, setSegredos] = useState<Record<string, SecretState>>({});
  const [teste, setTeste] = useState<MetaTestResponse | null>(null);

  const jaTem = (key: string) => inicial.secrets[key] === true;

  const salvar = useAcao(
    () =>
      api<{ tracking: Tracking }>('/tracking', {
        method: 'PUT',
        body: {
          tracking: {
            gtmId: t.gtmId.trim(),
            meta: {
              pixelId: t.meta.pixelId.trim(),
              testEventCode: t.meta.testEventCode.trim(),
              events: t.meta.events,
            },
            ga4: { measurementId: t.ga4.measurementId.trim() },
            googleAds: {
              conversionId: t.googleAds.conversionId.trim(),
              conversionLabel: t.googleAds.conversionLabel.trim(),
            },
            tiktok: { pixelCode: t.tiktok.pixelCode.trim() },
            kwai: { pixelId: t.kwai.pixelId.trim() },
          },
          secrets: coletarSecrets(segredos),
        },
      }),
    { sucesso: 'Rastreamento salvo.', invalidar: [chaves.tracking, chaves.config] },
  );

  const testarMeta = useAcao(() => api<MetaTestResponse>('/tracking/meta/test', { method: 'POST' }), {
    onSuccess: (res) => setTeste(res),
  });

  const alternarEvento = (id: string, ligado: boolean) =>
    setT((atual) => ({
      ...atual,
      meta: {
        ...atual.meta,
        events: ligado ? [...new Set([...atual.meta.events, id])] : atual.meta.events.filter((e) => e !== id),
      },
    }));

  const gtmInvalido = t.gtmId.trim() !== '' && !/^GTM-[A-Z0-9]+$/.test(t.gtmId.trim());

  const botaoSalvar = (
    <Actions>
      <Button loading={salvar.isPending} onClick={() => salvar.mutate(undefined)} disabled={gtmInvalido}>
        Salvar rastreamento
      </Button>
      <span className="text-2xs text-muted">Salva as três abas de uma vez.</span>
    </Actions>
  );

  return (
    <Tabs defaultValue="meta">
      <TabsList>
        <TabsTrigger value="meta">Meta (servidor)</TabsTrigger>
        <TabsTrigger value="gtm">Google Tag Manager</TabsTrigger>
        <TabsTrigger value="outras">Outras plataformas</TabsTrigger>
      </TabsList>

      {/* ------------------------------------------------------- Meta --- */}
      <TabsContent value="meta">
        <Card>
          <CardTitle
            title="Meta — API de Conversões"
            hint="Os eventos saem daqui do servidor, não do navegador: não dependem de bloqueador de anúncio, aba fechada nem cookie de terceiro. O Purchase nasce no webhook do pagamento."
          />

          <div className="grid gap-4">
            <FieldGrid>
              <Field label="Pixel ID (dataset)" htmlFor="pixel">
                <Input
                  id="pixel"
                  inputMode="numeric"
                  placeholder="1234567890123456"
                  value={t.meta.pixelId}
                  onChange={(e) => setT({ ...t, meta: { ...t.meta, pixelId: e.target.value } })}
                />
              </Field>
              <Field
                label="Código de teste"
                hint="Só para a aba Testar eventos do Events Manager. Deixe vazio em produção."
                htmlFor="testcode"
              >
                <Input
                  id="testcode"
                  maxLength={32}
                  placeholder="TEST12345"
                  value={t.meta.testEventCode}
                  onChange={(e) => setT({ ...t, meta: { ...t.meta, testEventCode: e.target.value } })}
                />
              </Field>
            </FieldGrid>

            <SecretInput
              label="Token da API de Conversões"
              hint="Events Manager › Configurações › Gerar token de acesso."
              isSet={jaTem('meta.capiToken')}
              state={segredos['meta.capiToken'] ?? secretVazio}
              onChange={(s) => setSegredos((m) => ({ ...m, 'meta.capiToken': s }))}
            />

            <div>
              <GroupTitle>Quais eventos enviar</GroupTitle>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {inicial.availableEvents.map((ev) => (
                  <ToggleRow
                    key={ev.id}
                    label={ev.label}
                    hint={`Vai para a Meta como ${ev.meta}.`}
                    checked={t.meta.events.includes(ev.id)}
                    onChange={(v) => alternarEvento(ev.id, v)}
                  />
                ))}
              </div>
              <p className="mt-3 text-2xs text-muted">
                Cada evento leva o mesmo <code>event_id</code> que foi para o dataLayer. Se você montar
                uma tag de Pixel no GTM, use esse <code>event_id</code> como <code>eventID</code> dela —
                é o que faz a Meta tratar os dois como um evento só, em vez de contar a venda duas vezes.
              </p>
            </div>

            {teste ? (
              <Callout tom={teste.ok ? 'ok' : 'err'}>
                {teste.detail ?? teste.message ?? (teste.ok ? 'A Meta aceitou o evento de teste.' : 'A Meta recusou o evento.')}
              </Callout>
            ) : null}

            <Actions>
              <Button variant="ghost" loading={testarMeta.isPending} onClick={() => testarMeta.mutate(undefined)}>
                Enviar evento de teste
              </Button>
              <span className="text-2xs text-muted">
                Chama a API de verdade e devolve o que a Meta respondeu.
              </span>
            </Actions>
          </div>
        </Card>
        {botaoSalvar}
      </TabsContent>

      {/* -------------------------------------------------------- GTM --- */}
      <TabsContent value="gtm">
        <Card>
          <CardTitle
            title="Google Tag Manager"
            hint="O único identificador que chega ao HTML da página. Gatilhos e tags você monta dentro do GTM — foi assim que o dono pediu."
          />
          <Field
            label="Container ID"
            error={gtmInvalido ? 'Formato esperado: GTM- seguido de letras e números.' : null}
            hint="Vazio = o carregador do GTM não é injetado na página."
            htmlFor="gtm"
          >
            <Input
              id="gtm"
              placeholder="GTM-XXXXXXX"
              value={t.gtmId}
              onChange={(e) => setT({ ...t, gtmId: e.target.value.toUpperCase() })}
              aria-invalid={gtmInvalido || undefined}
            />
          </Field>
          <p className="mt-3 text-2xs text-muted">
            A tag entra com o <code>nonce</code> da requisição, e as tags de HTML customizado criadas
            dentro do GTM herdam esse nonce automaticamente — é o que permite manter a CSP da LP sem{' '}
            <code>unsafe-inline</code>.
          </p>
        </Card>
        {botaoSalvar}
      </TabsContent>

      {/* ---------------------------------------------------- Outras --- */}
      <TabsContent value="outras">
        <Card>
          <CardTitle
            title="Outras plataformas"
            hint="Ficam guardadas e entram no mesmo envio pelo servidor conforme forem ligadas. Nenhuma delas carrega script na página."
          />
          <div className="grid gap-6">
            <div>
              <GroupTitle>Google Analytics 4</GroupTitle>
              <div className="grid gap-4">
                <FieldGrid>
                  <Field label="Measurement ID">
                    <Input
                      placeholder="G-XXXXXXXXXX"
                      value={t.ga4.measurementId}
                      onChange={(e) => setT({ ...t, ga4: { measurementId: e.target.value } })}
                    />
                  </Field>
                </FieldGrid>
                <SecretInput
                  label="API Secret do GA4"
                  hint="Admin › Fluxos de dados › Measurement Protocol."
                  isSet={jaTem('ga4.apiSecret')}
                  state={segredos['ga4.apiSecret'] ?? secretVazio}
                  onChange={(s) => setSegredos((m) => ({ ...m, 'ga4.apiSecret': s }))}
                />
              </div>
            </div>

            <div>
              <GroupTitle>Google Ads</GroupTitle>
              <FieldGrid>
                <Field label="Conversion ID">
                  <Input
                    placeholder="AW-123456789"
                    value={t.googleAds.conversionId}
                    onChange={(e) => setT({ ...t, googleAds: { ...t.googleAds, conversionId: e.target.value } })}
                  />
                </Field>
                <Field label="Conversion Label">
                  <Input
                    placeholder="AbC-D_efG"
                    value={t.googleAds.conversionLabel}
                    onChange={(e) => setT({ ...t, googleAds: { ...t.googleAds, conversionLabel: e.target.value } })}
                  />
                </Field>
              </FieldGrid>
            </div>

            <div>
              <GroupTitle>TikTok Ads</GroupTitle>
              <div className="grid gap-4">
                <FieldGrid>
                  <Field label="Pixel Code">
                    <Input
                      placeholder="C4A1B2C3D4E5F6"
                      value={t.tiktok.pixelCode}
                      onChange={(e) => setT({ ...t, tiktok: { pixelCode: e.target.value } })}
                    />
                  </Field>
                </FieldGrid>
                <SecretInput
                  label="Token da Events API"
                  isSet={jaTem('tiktok.accessToken')}
                  state={segredos['tiktok.accessToken'] ?? secretVazio}
                  onChange={(s) => setSegredos((m) => ({ ...m, 'tiktok.accessToken': s }))}
                />
              </div>
            </div>

            <div>
              <GroupTitle>Kwai Ads</GroupTitle>
              <div className="grid gap-4">
                <FieldGrid>
                  <Field label="Pixel ID">
                    <Input
                      placeholder="ID do pixel"
                      value={t.kwai.pixelId}
                      onChange={(e) => setT({ ...t, kwai: { pixelId: e.target.value } })}
                    />
                  </Field>
                </FieldGrid>
                <SecretInput
                  label="Token da API"
                  isSet={jaTem('kwai.accessToken')}
                  state={segredos['kwai.accessToken'] ?? secretVazio}
                  onChange={(s) => setSegredos((m) => ({ ...m, 'kwai.accessToken': s }))}
                />
              </div>
            </div>
          </div>
        </Card>
        {botaoSalvar}
      </TabsContent>
    </Tabs>
  );
}
