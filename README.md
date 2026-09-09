# Código Vencedor

Landing page de vendas, checkout Pix e painel administrativo.

Um único processo Node serve a página, o painel e a API. Nenhum segredo chega
ao navegador: o HTML recebe apenas o ID público do GTM e a configuração visual.

> **Documentação de contexto e decisões** (arquitetura, lições, "de onde paramos"):
> wiki Obsidian interna, fora deste repositório — comece por `index.md` e
> `ponto-de-retomada.md`. Este README é a documentação operacional.

## Estado atual

| Marco | Situação |
|---|---|
| **M1** — esqueleto, CSP com nonce, Docker | ✅ pronto |
| **M2** — banco, config do site, admin (login, conteúdo, aparência, escassez, links) | ✅ pronto |
| **M2.5** — modo de checkout por link, tela de gateway, registro de eventos do site | ✅ pronto |
| **M3** — checkout funcionando: BR Code, QR Code, página de obrigado, modo demonstração | ✅ pronto |
| **M4** — gateway Mercado Pago + webhook de entrada assinado | ✅ pronto — esperando o access token do dono |
| **M5** — Meta CAPI pelo servidor, tela de Rastreamento, cliques no dataLayer | ✅ pronto |
| **M6** — e-mail (Gmail/SMTP), templates, recuperação de checkout e de Pix, "esqueci minha senha" | ✅ pronto |
| **M7** — Dashboard com métricas, gráficos e funil | ✅ pronto |
| **M8** — gateway Appmax | ✅ pronto — esperando as credenciais do dono |
| **Painel em React** — 14 telas, Tailwind + Radix, compilado por Vite | ✅ pronto (o anterior segue em `/admin-legacy`) |
| Tela de Pedidos e tela de Auditoria | a fazer |

## Rodar localmente

Precisa de Node 22+ e Docker.

```bash
npm install

# banco de desenvolvimento
docker run -d --name cv-postgres-dev \
  -e POSTGRES_USER=cv -e POSTGRES_PASSWORD=cv -e POSTGRES_DB=cv \
  -p 55432:5432 postgres:16-alpine

cp .env.example .env
# preencha JWT_SECRET e ENCRYPTION_KEY (os comandos estão dentro do arquivo)
# e aponte DATABASE_URL para postgresql://cv:cv@localhost:55432/cv

npx prisma migrate deploy
npm run seed          # cria a config padrão e o primeiro admin
npm run dev
```

- Landing page: <http://localhost:3000>
- Painel: <http://localhost:3000/admin>

O primeiro login usa `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env` e **exige troca
de senha** — essa senha passou por variável de ambiente e log de deploy.

## Estrutura

```
public/          landing page estática (HTML + CSS + JS, sem framework — NÃO tem build)
panel/           painel administrativo em React (Vite + Tailwind + Radix)
  src/           telas, componentes e camada de API do painel
  dist/          bundle compilado, servido em /admin (gerado por npm run build:panel)
admin/           painel anterior, vanilla — servido em /admin-legacy durante a transição
src/
  server.ts      boot, arquivos estáticos, headers de segurança
  routes/        public (config) · track (eventos) · checkout (Pix, rascunho de lead)
                 admin (auth, config, gateway, tracking, eventos, metrics, email, recovery, users)
  services/      config · crypto (AES-256-GCM, hashes) · secrets (credenciais cifradas)
                 mailer (SMTP hoje, Resend depois) · emailTemplates · recovery (job de abandono)
  gateways/      mercadopago · appmax · staticPix (BR Code + CRC16) · index (escolha)
  lib/           auth (JWT + bcrypt) · security (CSP, IP) · audit · html
prisma/          schema, migrations e seed
```

## Paleta de venda

Amarelo e verde têm papéis separados: o **amarelo** (`#f5c518`) é identidade —
títulos, preço, rótulos; o **verde** (`#22c55e`) é ação — todo botão que leva
à compra. Quando tudo era amarelo, o botão competia com meia dúzia de
elementos da mesma cor. O verde veio das próprias artes da marca (selo do
e-book, barra do hero mobile) e foi conferido por contraste: 8,73:1 contra o
fundo, 8,20:1 do rótulo escuro sobre ele.

A urgência (barra do checkout, tarja "oferta termina em") é **vermelha**
(`#a51616`) com texto branco e o cronômetro em amarelo — 7,70:1 e 4,73:1.

Tudo isso é editável em **Aparência**, no painel.

## Mobile

Mais de 90% do tráfego chega pelo celular, então a primeira tela foi montada
para ele: logo e botão numa linha só (os links de seção somem — a página é
linear e rolar alcança tudo), headline grande sobre um véu escuro forte, preço
e CTA de largura total dentro da primeira dobra. O fundo do hero é o estádio
escuro, no desktop e no mobile.

## Mercado Pago e Appmax — prontos para receber as credenciais

Os adaptadores estão em `src/gateways/mercadopago.ts` e
`src/gateways/appmax.ts`, com os nomes de campo conferidos na documentação
oficial de cada um (não afirmados de memória) e a data de expiração do Pix no
formato com deslocamento de fuso que o Mercado Pago exige — `toISOString()`
com `Z` é recusado com o erro 23 e a cobrança nem nasce.

Cada um só é usado quando a credencial dele está cadastrada em **Gateway**;
sem ela, cai no Pix estático. A validação da notificação de entrada falha
fechada nos dois: sem segredo gravado, nada é aceito. Ver a seção
[Gateways de pagamento](#gateways-de-pagamento).

## Como o cliente paga

Duas opções, na tela **Checkout** do painel:

- **Formulário na própria página** — o comprador preenche os dados e recebe o
  QR Code sem sair do site. Maior conversão, exige um gateway configurado.
- **Apenas um botão** — a seção de checkout some e os quatro CTAs passam a
  apontar para um link de pagamento externo (Appmax, Hotmart, Kiwify,
  Mercado Pago…). Não exige gateway nenhum e serve para vender enquanto a
  integração não está pronta.

Sem URL preenchida o modo "botão" é ignorado e o formulário continua — melhor
isso do que uma página sem nenhum caminho de compra.

## Checkout Pix

O fluxo completo já roda: formulário validado no servidor (CPF pelos dígitos
verificadores, telefone com DDD), pedido gravado, BR Code gerado com CRC16 e
QR Code renderizado, contador de expiração e confirmação levando para
`/obrigado`.

**Sem chave Pix cadastrada**, a cobrança sai marcada como demonstração: mesma
estrutura e mesmo CRC, mas com uma chave num domínio `.invalid`, que nunca vai
existir. A página avisa em vermelho que o código não é pagável e mostra um
botão para confirmar o pagamento, permitindo percorrer o fluxo inteiro antes de
haver credencial. Esse botão só responde para cobranças de demonstração — um
pedido real nunca pode ser marcado como pago por ali.

Cadastre a chave em **Gateway** e as cobranças passam a ser reais na hora, sem
mexer em código. O Pix estático não tem webhook: o dinheiro cai direto na sua
conta e a baixa é feita conferindo o extrato. A automação existe nos outros dois
provedores: **Mercado Pago** e **Appmax** confirmam por webhook, e basta colar
as credenciais na tela Gateway.

## Gateways de pagamento

Três provedores prontos, escolhidos na tela **Gateway**. A regra do servidor é
"provedor escolhido **e** credencial presente": faltando credencial, a venda cai
no Pix estático em vez de derrubar o checkout na cara do comprador.

| Provedor | Credenciais | Confirmação do pagamento |
|---|---|---|
| **Pix estático** | chave Pix + razão social + cidade | manual, pelo extrato |
| **Mercado Pago** | access token + chave secreta do webhook | webhook assinado (HMAC-SHA256) + consulta à API |
| **Appmax** | client_id + client_secret + um segredo de webhook que você define | segredo na URL + consulta à API |

O botão **Testar conexão** chama o provedor de verdade: o Mercado Pago responde
`GET /users/me` e a Appmax entrega (ou nega) um token OAuth2. Nenhuma das duas
chamadas cria pagamento, cliente ou pedido. O painel também avisa quando a
credencial é de teste e a loja está em produção — combinação que gera Pix que
ninguém consegue pagar.

### Webhooks de entrada

Cadastre no painel do provedor:

- Mercado Pago: `https://SEU-DOMINIO/webhooks/mercadopago`
- Appmax: `https://SEU-DOMINIO/webhooks/appmax?t=SEU_SEGREDO`

Duas regras valem para os dois, e são elas que impedem que alguém libere acesso
mandando um POST:

1. **Sem prova de origem, não passa.** O Mercado Pago assina cada notificação e
   a assinatura é conferida em tempo constante. A Appmax **não assina nada** —
   está na documentação deles — então a prova é um segredo que você define e que
   viaja na URL. Nos dois casos a validação falha fechada: sem segredo gravado,
   nada é aceito.
2. **O status nunca vem do corpo.** A notificação só diz *qual* pedido mexeu; o
   estado real é lido de volta na API do provedor. É o que torna inofensivo o
   reenvio de um "aprovado" antigo — e o que faz uma notificação forjada, mesmo
   com o segredo certo, não conseguir marcar nada como pago.

Notificação repetida não processa duas vezes: o índice único
`(provider, externalId)` de `WebhookEvent` é o trinco, no banco. Uma tentativa
que falhou fica com `processedAt` nulo de propósito, para o reenvio do provedor
poder tentar de novo — senão uma queda momentânea da API dele viraria um
pagamento sem acesso liberado.

## Eventos do site

A landing page envia cada passo do funil para `POST /api/track`, que grava na
tabela `FunnelEvent`. A tela **Eventos** mostra três coisas: o funil do período
(com sessões distintas, não só disparos), a origem do tráfego por `utm_source`
e a lista dos últimos eventos — essa última útil para conferir se o
rastreamento está chegando enquanto se mexe no GTM.

Só eventos de uma lista fechada são aceitos; o resto é descartado em silêncio
para ninguém inflar a tabela com nomes arbitrários.

## Rastreamento

**No navegador** existe uma coisa só: o dataLayer do GTM. Cada passo do funil
vira um push com `event_id`, e todo clique em botão ou link entra como evento
`click` com rótulo, tipo, seção e destino — o suficiente para montar gatilhos
no GTM sem tocar no código.

**No servidor** é onde a Meta é chamada, pela API de Conversões: hash SHA-256
nos dados de identificação, `fbp`/`fbc`/IP/user-agent em claro como a
documentação exige, timeout de 1500 ms e retry só em erro não-cliente. O
`Purchase` nasce no momento em que o pagamento é confirmado — nunca a partir
de uma chamada do navegador, senão bastaria alguém chamar a rota para
registrar uma venda que não existe.

Se você criar uma tag de Pixel dentro do GTM, use a variável `event_id` da
camada de dados como `eventID` dela: é o que faz a Meta tratar o evento do
navegador e o do servidor como um só.

## Dashboard

Receita por dia, origem do tráfego, funil por sessões distintas e os últimos
pedidos. Os gráficos usam Chart.js servido de `admin/vendor/` — a CSP do
painel não libera CDN.

Duas decisões de leitura que valem registro: a origem do tráfego é gráfico de
barras, e não rosca, porque o limite de cores distinguíveis por quem tem
daltonismo obrigaria a jogar metade das fontes num balde "outras" que ficava
maior que qualquer fonte nomeada; e a etapa "Pagaram" do funil vem da tabela
de pedidos, não da de eventos, para não divergir do cartão de receita.

## E-mail e recuperação de vendas

Aba **E-mail** do painel. O provedor é escolhido lá — hoje **SMTP** (Gmail com
senha de app, ou qualquer servidor); a interface do `mailer` é pequena de
propósito para Resend/SES entrarem como mais um `case`. A senha do SMTP é um
segredo cifrado (`email.apiKey`), nunca volta para o navegador. "Testar
conexão" autentica sem enviar nada; "Enviar teste" manda o template com dados
fictícios e assunto `[TESTE]`.

Cinco templates, todos editáveis no painel (texto puro, o servidor monta o HTML):

| Template | Quando sai | Variáveis |
|---|---|---|
| Compra aprovada | pagamento confirmado (webhook ou pagamento simulado) | `nome email pedido valor link_acesso suporte` |
| Checkout abandonado | lead **rascunho** (digitou nome e e-mail válidos, não gerou o Pix) parado há N min | `nome link_checkout valor suporte` |
| Pix não pago | pedido **expirado** há N min, sem outro pedido pago da mesma pessoa | `nome pedido link_checkout valor suporte` |
| Recuperação de senha | "Esqueci minha senha" no login do painel — link de uso único, 30 min | `nome link_reset minutos` |
| Convite | administrador cadastra alguém — link para criar a senha, 48 h | `nome convidado_por link_convite horas` |

Como o abandono vira dado: a página grava um **rascunho de lead** assim que
nome e e-mail ficam válidos (`POST /api/checkout/draft`, no `blur` e no
`pagehide`). Quem depois gera o Pix reaproveita o mesmo registro e ele vira
`complete`. O job `startRecoveryJob` roda a cada minuto: marca `expired` o Pix
vencido, envia os dois e-mails de recuperação e grava `recoveryEmailAt` **antes**
de enviar — cada pessoa recebe no máximo um e-mail de cada tipo. Os links dos
e-mails carregam `utm_medium=recuperacao`, e é isso que o cartão "Recuperados"
conta.

Aba **Recuperação**: cartões (checkout abandonado, Pix não pago, recuperados,
e-mails de compra) e duas listas; clicar numa linha abre horários, dados do
cliente (e-mail, WhatsApp, final do CPF), origem (UTM, dispositivo, IP) e o
estado do e-mail de recuperação. "Rodar recuperação agora" executa o job sem
esperar o minuto. O Dashboard ganhou o cartão **Abandonos**, que leva para lá.

## Usuários e papéis

Aba **Usuários** (só para administradores). Dois papéis:

| Papel | Pode |
|---|---|
| **Administrador** (`owner`) | tudo — inclusive gateway, segredos e usuários |
| **Usuário** (`editor`) | conteúdo, aparência, escassez, links, checkout, métricas, recuperação e a própria conta |

Convite: a conta nasce com uma senha aleatória que ninguém conhece e um link
de uso único (48 h) para a pessoa criar a dela — nenhuma senha viaja por
e-mail. O administrador pode reenviar o convite, trocar o papel e excluir
(dois cliques, sem diálogo do navegador). Regras: não dá para excluir a própria
conta nem rebaixar/excluir o último administrador; mudar o papel derruba as
sessões da pessoa.

A troca de senha fica em **Minha conta** (não mais na barra lateral).

## Segurança

- **CSP estrita com nonce por request.** Nenhum `style=""` ou `onclick` no HTML;
  o GTM é injetado com o nonce que o servidor renderiza. A CSP do `/admin` é mais
  fechada que a da landing page e não libera terceiro nenhum — React, Radix,
  Tailwind e Chart.js entram no bundle, nada vem de CDN. O nonce vale para
  `script-src` **e** `style-src`, porque o Radix insere uma folha de estilo ao
  abrir modal; `unsafe-inline` continua fora das duas políticas, então
  `style=""` segue proibido no painel (estilo dinâmico é escrito por CSSOM).
- **Nada de segredo no front.** O painel é código público: nenhuma credencial
  entra no bundle, o `sourcemap` não é publicado e as rotas do painel devolvem
  *booleano* para dizer se uma credencial existe — nunca o valor. A sessão vive
  só em cookie `httpOnly`, invisível ao JavaScript, e o painel não guarda nada
  em `localStorage`.
- **CPF cifrado em repouso** (AES-256-GCM). No painel aparece mascarado.
  Perder a `ENCRYPTION_KEY` torna os dados cifrados ilegíveis — guarde-a.
- **Senhas em bcrypt** (custo 12), com bloqueio de 15 minutos após 5 tentativas.
- **JWT em cookie `httpOnly`** de 15 minutos + refresh rotativo de 7 dias.
  Trocar a senha derruba as outras sessões.
- **Links de senha e convite** guardam só o hash SHA-256 do token; são de uso
  único, expiram (30 min / 48 h) e redefinir a senha revoga todas as sessões.
  "Esqueci minha senha" responde sempre a mesma coisa, exista o e-mail ou não.
- **Rate limit** por IP real (`CF-Connecting-IP` quando `TRUST_CLOUDFLARE=true`).
- **Auditoria** de toda alteração feita no painel, com campos sensíveis ocultos.
- **Credenciais de gateway cifradas** numa tabela separada da configuração
  visual, e que **nunca voltam** para o navegador: a tela mostra "configurado"
  e um botão de substituir.

## Deploy (VPS + Portainer + Cloudflare Tunnel)

A stack **não publica nenhuma porta no host**: `db`, `api` e `cloudflared`
conversam por uma rede interna própria. Quem expõe o site para a internet é o
túnel, que sai da VPS para o Cloudflare — a origem nunca fica aberta.

1. Suba o repositório para o GitHub.
2. Em **Cloudflare Zero Trust → Networks → Tunnels**, crie um túnel, copie o
   token e adicione um **Public Hostname** com o seu domínio apontando para
   `http://api:3000` (nome do serviço na rede da stack, não IP nem porta).
3. Na VPS, crie o diretório dos backups: `mkdir -p /opt/codigo-vencedor/backups`.
4. No Portainer, crie uma stack do tipo **Repository** apontando para o
   repositório (`docker-compose.yml` na raiz) e marque *Enable relative path
   volumes* apenas se for usar caminhos relativos — aqui o backup usa caminho
   absoluto do host.
5. Defina as variáveis de ambiente na própria stack — veja `.env.example`.
   Obrigatórias: `POSTGRES_PASSWORD`, `PUBLIC_URL`, `JWT_SECRET`,
   `ENCRYPTION_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`. Para o primeiro boot, também
   `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
6. Mantenha `TRUST_CLOUDFLARE=true` — sem isso o rate limit enxerga apenas o IP
   do `cloudflared` e todo mundo cai no mesmo balde.
7. No DNS do Cloudflare, o registro do hostname é criado pelo próprio túnel
   (CNAME proxied). Não crie um registro A para o IP da VPS.

As migrations rodam sozinhas no start (`prisma migrate deploy`). O serviço
`backup` grava um `pg_dump` diário em `BACKUP_DIR` (padrão
`/opt/codigo-vencedor/backups`), mantendo 14 dias.

Healthcheck: `GET /healthz`.

> **Segredos nunca vivem neste repositório.** `.env` é ignorado pelo git; as
> variáveis acima ficam só na stack do Portainer, e as credenciais de gateway,
> Meta CAPI e SMTP ficam cifradas (AES-256-GCM) na tabela `Secret` do banco.

## Comandos

| Comando | Faz |
|---|---|
| `npm run dev` | servidor com recarga automática |
| `npm run dev:panel` | painel React com HMR em <http://localhost:5174/admin/> (proxy da API para a 3100) |
| `npm run build` | compila o servidor para `dist/` **e** o painel para `panel/dist/` |
| `npm run build:panel` | compila só o painel |
| `npm start` | roda o build |
| `npm run typecheck` | checagem de tipos do servidor **e** do painel |
| `npm run prisma:migrate` | cria uma migration nova a partir do schema |
| `npm run prisma:deploy` | aplica as migrations pendentes |
| `npm run seed` | config padrão + primeiro admin (idempotente) |

## Sobre os blocos de escassez

O contador, o "restam N vagas" e o "N compraram nas últimas 24h" podem ser
desligados individualmente no painel, e cada um tem dois modos: um número que
você escolhe, ou o dado real vindo do banco (vagas descontadas das vendas,
compradores contados dos pedidos pagos).

No Brasil, número inventado de vaga ou de comprador é o que o art. 37 do CDC
trata como publicidade enganosa, e costuma pegar também na análise de anúncio
do Meta. O padrão de fábrica é o modo manual, herdado do desenho original —
a decisão é sua, mas as duas opções estão disponíveis.

---

© Código Vencedor. Todos os direitos reservados. Código publicado sem licença
de uso: leitura permitida; uso, cópia ou redistribuição não são autorizados.
