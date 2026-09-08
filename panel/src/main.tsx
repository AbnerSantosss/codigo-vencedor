import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setNonce } from 'get-nonce';
import { ehSessaoExpirada } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { App } from './App';
import './styles/app.css';

/* ==========================================================================
   Nonce para o <style> que o Radix injeta

   Ao abrir um modal ou a gaveta de navegação, o `react-remove-scroll`
   (dependência do Dialog do Radix) trava a rolagem do fundo inserindo um
   `<style>` no documento. Sob a CSP do painel, sem `unsafe-inline`, essa
   folha só é aceita se carregar o nonce da requisição — e é este `setNonce`
   que a faz carregar. O `get-nonce` é o ponto de leitura usado pela família
   `react-style-singleton`, e há uma única cópia dele no bundle (conferido no
   arquivo compilado: um criador de `<style>`, um leitor de nonce).

   Só isto não bastava. O nonce vivia apenas em `script-src`, e nonce de
   script não vale para folha de estilo — o Chrome bloqueava a folha com
   "Applying inline style violates … 'style-src 'self''" e o modal abria com
   o fundo rolando atrás, sem erro visível. A outra metade da correção está
   em `src/lib/security.ts`: o nonce entrou também no `style-src`.

   O `{{nonce}}` literal aparece só no servidor de desenvolvimento do Vite,
   que serve o HTML sem passar pelo Fastify e sem CSP; por isso o guarda.
   ========================================================================== */
const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content') ?? '';
if (nonce && !nonce.startsWith('{{')) setNonce(nonce);

/**
 * Cache das telas.
 *
 * O painel antigo guardava cada resposta num objeto `state` global e só
 * buscava de novo se estivesse vazio — o que significava que uma aba aberta
 * há duas horas mostrava número velho sem avisar. Aqui o TanStack Query faz
 * o mesmo trabalho com prazo: 30 s de "fresco" (trocar de tela e voltar não
 * refaz a chamada) e revalidação quando a janela volta ao foco.
 *
 * `retry` nunca tenta de novo um 401: o retry de sessão é o refresh único da
 * camada de API, e repetir aqui faria N refreshes concorrentes — exatamente
 * o defeito que destruía a sessão de 7 dias.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (tentativas, erro) => !ehSessaoExpirada(erro) && tentativas < 1,
    },
    mutations: { retry: false },
  },
});

const raiz = document.getElementById('root');
if (!raiz) throw new Error('#root não existe no HTML do painel');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
