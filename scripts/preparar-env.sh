#!/usr/bin/env bash
# Completa o .env da VPS sem destruir o que ja existe.
#
# Regra que este script existe para garantir: ENCRYPTION_KEY e POSTGRES_PASSWORD
# so nascem uma vez. Regenerar a ENCRYPTION_KEY torna ilegiveis os CPFs e as
# credenciais de gateway ja gravados; trocar a senha do Postgres deixa a api
# sem entrar no banco que ja tem os pedidos.
#
# Uso (dentro da VPS, no diretorio da stack):
#   bash preparar-env.sh <PUBLIC_URL>
#
# Os segredos sao gerados aqui, na propria VPS: nenhum trafega pela rede.
set -euo pipefail

PUBLIC_URL="${1:-}"
ENV_FILE=".env"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Escreve a chave so se ela ainda nao existir.
por() {
  local k="$1" v="$2"
  if ! grep -q "^${k}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
    echo "  + ${k} (novo)"
  else
    echo "  = ${k} (preservado)"
  fi
}

# Sobrescreve sempre — so para o que nao e segredo.
troca() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
  echo "  > ${k}"
}

ler() { grep "^${1}=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

echo "variaveis:"
por POSTGRES_USER      "codigovencedor"
por POSTGRES_DB        "codigovencedor"
por POSTGRES_PASSWORD  "$(openssl rand -hex 24)"
por JWT_SECRET         "$(openssl rand -base64 48 | tr -d '\n')"
por ENCRYPTION_KEY     "$(openssl rand -base64 32 | tr -d '\n')"
por ADMIN_EMAIL        "admin@codigovencedor.local"
por ADMIN_PASSWORD     "$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-16)"

troca NODE_ENV         "production"
troca LOG_LEVEL        "info"
troca TRUST_CLOUDFLARE "true"
troca BACKUP_DIR       "$(pwd)/backups"

if [ -n "$PUBLIC_URL" ]; then
  troca PUBLIC_URL "$PUBLIC_URL"
else
  por PUBLIC_URL "http://127.0.0.1:3100"
fi

# DATABASE_URL sempre derivada do que esta no proprio .env, para nao divergir
# da senha real do Postgres depois de um deploy que a preservou.
troca DATABASE_URL "postgresql://$(ler POSTGRES_USER):$(ler POSTGRES_PASSWORD)@db:5432/$(ler POSTGRES_DB)"

chmod 600 "$ENV_FILE"
echo "total: $(grep -c '=' "$ENV_FILE") variaveis em $(pwd)/$ENV_FILE (modo 600)"
