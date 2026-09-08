# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Instala dependências primeiro para aproveitar o cache de camada quando só
# o código muda.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
# O painel administrativo é React compilado por Vite. Ele é construído aqui,
# no estágio de build — a imagem final não leva React, Vite nem node_modules
# de desenvolvimento, só o bundle estático de `panel/dist`.
COPY panel ./panel
RUN npx prisma generate && npm run build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/panel/dist ./panel/dist
COPY public ./public
# Painel anterior (vanilla), servido em /admin-legacy como rede de segurança
# durante a transição. Pode sair da imagem quando o dono validar o novo.
COPY admin ./admin

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini garante que SIGTERM chegue ao Node (encerramento limpo no redeploy).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
