# Código Vencedor — instruções para o agente

Fonte única da verdade para qualquer agente (Claude Code, Gemini CLI/Antigravity, Codex) que abrir esta pasta. `GEMINI.md` e `AGENTS.md` apontam para cá — se as regras mudarem, mude **só este arquivo**.

## 1. A documentação do projeto está na wiki

Contexto, decisões, lições e o estado do trabalho estão registrados na wiki local do workspace em `../wiki/` e no cofre Obsidian local, em `Projetos/Código Vencedor/wiki/` (fora deste repositório).

Antes de qualquer tarefa, leia de lá:

1. `index.md` — catálogo e "por onde começar" por tipo de tarefa.
2. `ponto-de-retomada.md` — **o estado atual**: pronto, pendente, e o que espera o dono.
3. `armadilhas-e-licoes.md` — 86 coisas que já quebraram aqui.

Este `README.md` é a documentação operacional (comandos, deploy, o que cada marco entregou).

## 2. Quando o dono perguntar "de onde paramos?", "o que falta?", "me lembra o que ficou pendente?"

**Responda com o bloco "Lembrete rápido" do topo de `ponto-de-retomada.md` (caminho acima), na íntegra e sem resumir.** Não invente estado: confirme no código ou diga que não sabe.

## 3. Ao concluir qualquer entrega

Registrar na wiki, na mesma sessão: atualizar `ponto-de-retomada.md`, acrescentar entrada em `log.md` (`## [AAAA-MM-DD] tipo | descrição`), atualizar/criar a página técnica do tema, listar em `index.md`, e registrar em `armadilhas-e-licoes.md` o que quebrou e como foi corrigido. Detalhes na seção 6 do `CLAUDE.md` da raiz do workspace (não existe `CLAUDE.md` dentro de `wiki/`).

## 4. Regras fixadas pelo dono (não renegociar sem ele)

- **Não alterar o design** da landing page. Só formatação, responsividade e o que ele pedir explicitamente.
- **Preço: R$ 27,90.** Se um teste mudar, restaurar antes de mostrar.
- **No HTML só a tag do GTM**; os gatilhos ele monta no próprio GTM.
- **Meta Ads só via Conversions API do servidor.**
- **Mobile é o público** (90%+): toda decisão de layout começa pelo celular.
- Sem preview ao vivo no painel; sem `confirm()` do navegador.
- **Segredos nunca em texto**: senha de app do Gmail, tokens de gateway e da CAPI vivem cifrados na tabela `Secret` (AES-256-GCM). Nunca imprimir, colar em resposta, commitar ou escrever na wiki.
- **Git só quando ele pedir.** O projeto ainda não tem repositório — não rode `git init`/`commit`/`push` por conta própria.
- Depois de um plano aprovado, ele quer execução até o fim, sem perguntas a cada passo.

## 5. Ambiente

| Item | Valor |
|---|---|
| Dev | `npm run dev` → **http://127.0.0.1:3100** (porta vem do `.env`, **não** é 3000) |
| Painel | http://127.0.0.1:3100/admin |
| Banco | contêiner `cv-postgres-dev`, porta **55432**, user/senha/db `cv` |
| Cache | `SiteConfig` e `Secret` têm **60 s** de cache — escrever direto no banco demora até 1 min para refletir |
| Antes de subir | `curl localhost:3100/healthz`: costuma já haver um `tsx watch` de pé (senão dá `EADDRINUSE`) |
| Checar código | `npx tsc --noEmit`; `node --check public/js/lp.js`; e para o painel, que virou 20 módulos ES em 2026-09-07, `for f in admin/app.js admin/js/*.js admin/js/screens/*.js; do node --check $f || echo $f; done` |

## 6. Armadilhas de ambiente (Windows + Git Bash)

- Heredoc mangla regex, template literal e `$(` — editar com ferramenta de edição ou script Node, e sempre checar depois.
- `curl` do Git Bash com acento no JSON → `FST_ERR_CTP_INVALID_CONTENT_LENGTH`. Usar ASCII nos testes.
- Script `.ts` fora do projeto vira CJS e quebra em top-level await → nomear `.mts`.
- No Node, usar `C:/Users/...`, não `/c/Users/...`.

A lista completa está em `armadilhas-e-licoes.md` na wiki.
