import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api, descreverErro } from '@/lib/api';
import type { ConfigPatch, ConfigResponse } from '@/lib/types';
import { useToast } from '@/components/ui/toast';

/* ==========================================================================
   Ganchos de dados

   Uma chave de cache por assunto (`config`, `gateway`, `tracking`, …). Salvar
   invalida a chave do assunto, e é isso que faz a tela mostrar o que o
   servidor gravou — não o que o navegador achava que tinha mandado.
   ========================================================================== */

export const chaves = {
  config: ['config'] as const,
  gateway: ['gateway'] as const,
  tracking: ['tracking'] as const,
  email: ['email'] as const,
  users: ['users'] as const,
  webhooks: ['webhooks'] as const,
  eventsSummary: (dias: number) => ['events', 'summary', dias] as const,
  events: (dias: number, evento: string | null) => ['events', 'list', dias, evento] as const,
  /**
   * Payload de um evento — chaveado só pelo id da linha.
   *
   * Sem período nem filtro na chave de propósito: o payload gravado não muda
   * mais, então a mesma linha reaberta depois de trocar o filtro reaproveita
   * o que já está em cache em vez de bater no servidor de novo.
   */
  eventDetail: (id: string) => ['events', 'detail', id] as const,
  /** Resumo de cliques por botão, seção e página. */
  clicks: (dias: number) => ['events', 'clicks', dias] as const,
  /** Linha do tempo de uma pessoa. Chaveada pelo lead, que é o que a rota usa. */
  journey: (leadId: string) => ['events', 'journey', leadId] as const,
  coupons: ['coupons'] as const,
  couponsUsage: (dias: number) => ['coupons', 'usage', dias] as const,
  recovery: (dias: number) => ['recovery', dias] as const,
  metrics: (dias: number) => ['metrics', dias] as const,
  inbound: ['webhooks', 'inbound'] as const,
  deliveries: (id: string) => ['webhooks', 'deliveries', id] as const,
};

export function useConfig(): UseQueryResult<ConfigResponse> {
  return useQuery({
    queryKey: chaves.config,
    queryFn: () => api<ConfigResponse>('/config'),
  });
}

/**
 * Salva uma seção do `SiteConfig`.
 *
 * PUT parcial de propósito: duas abas abertas em telas diferentes não
 * sobrescrevem o trabalho uma da outra, porque cada uma manda só o seu
 * pedaço (ver `src/routes/admin/config.ts`).
 */
export function useSalvarConfig(mensagem = 'Salvo. A página já está usando os novos valores.') {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (patch: ConfigPatch) =>
      api<{ ok: true; config: unknown }>('/config', { method: 'PUT', body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaves.config });
      toast.ok(mensagem);
    },
    onError: (err) => toast.erro(descreverErro(err)),
  });
}

/** Mutação genérica com aviso automático — para as telas fora do /config. */
export function useAcao<TVars, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  opcoes: {
    sucesso?: string | ((d: TData) => string);
    invalidar?: readonly (readonly unknown[])[];
    onSuccess?: (d: TData) => void;
  } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      for (const chave of opcoes.invalidar ?? []) void qc.invalidateQueries({ queryKey: chave });
      if (opcoes.sucesso) {
        toast.ok(typeof opcoes.sucesso === 'function' ? opcoes.sucesso(data) : opcoes.sucesso);
      }
      opcoes.onSuccess?.(data);
    },
    onError: (err) => toast.erro(descreverErro(err)),
  });
}
