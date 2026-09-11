#!/usr/bin/env python3
"""
Deploy da LP Codigo Vencedor numa VPS, por SSH.

Nao guarda segredo nenhum. Host, usuario e senha vem do ambiente; a senha de
app do Gmail vem do arquivo do dono, lido em tempo de execucao e nunca
impresso.

    CV_SSH_HOST=vps1.logame.cloud CV_SSH_PORT=2202 CV_SSH_USER=logame \
    CV_SSH_PASS='...' python scripts/deploy-vps.py

Variaveis:
    CV_SSH_HOST   obrigatoria
    CV_SSH_USER   obrigatoria
    CV_SSH_PORT   padrao 22
    CV_SSH_PASS   senha (ou use CV_SSH_KEY)
    CV_SSH_KEY    caminho de chave privada
    CV_REMOTE_DIR padrao /opt/codigo-vencedor
    CV_PUBLIC_URL dominio final; entra nos links de e-mail e no CAPI
    CV_TUNNEL_TOKEN token do tunel do Cloudflare Zero Trust; com ele o
                  cloudflared sobe junto (--profile tunnel) e publica o site
    CV_SMTP_FILE  arquivo KEY=valor com SMTP_HOST/PORT/USER/PASS
    CV_FROM_NAME  nome do remetente (padrao "Codigo Vencedor")
    CV_SKIP_EMAIL 1 = nao mexer no provedor de e-mail
    CV_DRY_RUN    1 = so diagnostica, nao altera nada

Ordem, e por que:
  1. conecta e confere docker/compose antes de enviar qualquer coisa;
  2. envia so o essencial (sem node_modules, dist, .env, backups);
  3. completa o .env remoto PRESERVANDO o que ja existe — regenerar a
     ENCRYPTION_KEY tornaria ilegiveis CPFs e credenciais ja gravados;
  4. sobe a stack com build;
  5. grava o provedor de e-mail no banco, cifrado (nao e variavel de ambiente);
  6. verifica /healthz e /api/config.
"""
import io
import os
import posixpath
import sys
import tarfile
import time
from pathlib import Path

try:
    import paramiko
except ImportError:
    sys.exit("falta paramiko: pip install paramiko")

RAIZ = Path(__file__).resolve().parent.parent

# Só o que a imagem precisa. node_modules/dist/.env ficam de fora de proposito.
INCLUIR = [
    "Dockerfile", "docker-compose.yml", "docker-compose.vps.yml",
    ".dockerignore", "package.json", "package-lock.json",
    "tsconfig.json", "tsconfig.seed.json", ".env.example", "README.md",
    "prisma", "src", "panel", "public", "admin", "scripts",
]
EXCLUIR_DIR = {
    "node_modules", "dist", "dist-seed", ".git", "backups",
    "_backup-original", "scratch", "landing-demo-antigravity",
}
EXCLUIR_ARQ = {".env", ".env.local"}


def log(msg):
    print(f"  {msg}", flush=True)


def secao(msg):
    print(f"\n=== {msg} ===", flush=True)


def montar_tar():
    """Tarball em memoria com os arquivos essenciais."""
    buf = io.BytesIO()
    n = 0
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for nome in INCLUIR:
            origem = RAIZ / nome
            if not origem.exists():
                log(f"ausente, ignorado: {nome}")
                continue
            if origem.is_file():
                tar.add(origem, arcname=nome)
                n += 1
                continue
            for p in sorted(origem.rglob("*")):
                if not p.is_file():
                    continue
                rel = p.relative_to(RAIZ)
                if EXCLUIR_DIR & set(rel.parts):
                    continue
                if p.name in EXCLUIR_ARQ:
                    continue
                tar.add(p, arcname=str(rel).replace(os.sep, "/"))
                n += 1
    buf.seek(0)
    return buf, n


def ler_env_arquivo(caminho):
    """Le um arquivo KEY=valor, ignorando comentarios e tirando aspas."""
    vals = {}
    p = Path(caminho)
    if not p.exists():
        return vals
    for linha in p.read_text(encoding="utf-8", errors="replace").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, _, v = linha.partition("=")
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        vals[k.strip()] = v
    return vals


def sh_quote(valor):
    """Aspas simples no estilo POSIX — a senha de app tem espacos."""
    return "'" + str(valor).replace("'", "'\\''") + "'"


def definir_env_remoto(cli, caminho, pares):
    """Grava chaves no .env remoto por SFTP, sem passar por linha de comando.

    Token de tunel e senha nao podem virar argumento de shell: ficariam
    visiveis em `ps` para qualquer usuario da VPS enquanto o comando roda, e
    no historico. Ler-alterar-gravar o arquivo evita as duas coisas.
    """
    sftp = cli.open_sftp()
    try:
        try:
            with sftp.open(caminho, "r") as f:
                linhas = f.read().decode("utf-8", "replace").splitlines()
        except IOError:
            linhas = []

        for chave, valor in pares.items():
            nova = f"{chave}={valor}"
            for i, linha in enumerate(linhas):
                if linha.startswith(f"{chave}="):
                    linhas[i] = nova
                    break
            else:
                linhas.append(nova)

        with sftp.open(caminho, "w") as f:
            f.write(("\n".join(linhas) + "\n").encode("utf-8"))
        sftp.chmod(caminho, 0o600)
    finally:
        sftp.close()


class Remoto:
    def __init__(self, cli):
        self.cli = cli

    def run(self, cmd, check=True, timeout=1800, mostrar=True, linhas=40):
        _, out, err = self.cli.exec_command(cmd, timeout=timeout)
        saida = out.read().decode("utf-8", "replace")
        erro = err.read().decode("utf-8", "replace")
        rc = out.channel.recv_exit_status()
        if mostrar:
            for linha in (saida + erro).strip().splitlines()[-linhas:]:
                if linha.strip():
                    log(linha)
        if check and rc != 0:
            raise RuntimeError(f"comando falhou (rc={rc}): {cmd.splitlines()[0][:120]}")
        return rc, saida, erro


def main():
    host = os.environ.get("CV_SSH_HOST")
    user = os.environ.get("CV_SSH_USER")
    if not host or not user:
        sys.exit("defina CV_SSH_HOST e CV_SSH_USER")
    port = int(os.environ.get("CV_SSH_PORT", "22"))
    senha = os.environ.get("CV_SSH_PASS")
    chave = os.environ.get("CV_SSH_KEY")
    if not senha and not chave:
        sys.exit("defina CV_SSH_PASS ou CV_SSH_KEY")

    remoto_dir = os.environ.get("CV_REMOTE_DIR", "/opt/codigo-vencedor")
    dry = os.environ.get("CV_DRY_RUN") == "1"

    secao(f"conectando em {user}@{host}:{port}")
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(
        hostname=host, port=port, username=user,
        password=senha, key_filename=chave,
        timeout=30, banner_timeout=30, auth_timeout=30,
        look_for_keys=bool(chave), allow_agent=False,
    )
    r = Remoto(cli)
    log("conectado")

    secao("ambiente da VPS")
    r.run("uname -sr; docker --version; docker compose version", check=False)
    rc, _, _ = r.run(f"test -d {remoto_dir}", check=False, mostrar=False)
    log(f"{remoto_dir}: {'ja existe' if rc == 0 else 'sera criado'}")
    if rc == 0:
        r.run(f"cd {remoto_dir} && docker compose ps 2>/dev/null | head -20", check=False)

    if dry:
        secao("CV_DRY_RUN=1 — parando aqui; nada foi alterado")
        cli.close()
        return

    # Com token de tunel, o cloudflared entra (perfil "tunnel" do override) e
    # e ele que publica o site. Sem token, so o nginx do host alcanca a api.
    tunnel_token = os.environ.get("CV_TUNNEL_TOKEN", "").strip()
    perfil = " --profile tunnel" if tunnel_token else ""
    compose = (f"cd {remoto_dir} && docker compose{perfil} "
               f"-f docker-compose.yml -f docker-compose.vps.yml")

    # ---- envio ------------------------------------------------------------
    secao("enviando arquivos")
    sudo = "" if user == "root" else "sudo -n "
    r.run(f"{sudo}mkdir -p {remoto_dir}/backups && "
          f"{sudo}chown -R $(id -u):$(id -g) {remoto_dir}", check=False, mostrar=False)

    tarbuf, n = montar_tar()
    tamanho = len(tarbuf.getvalue())
    log(f"{n} arquivos, {tamanho / 1_048_576:.1f} MB")
    sftp = cli.open_sftp()
    destino = posixpath.join("/tmp", f"cv-deploy-{int(time.time())}.tgz")
    sftp.putfo(tarbuf, destino)
    sftp.close()
    r.run(f"cd {remoto_dir} && tar xzf {destino} && rm -f {destino} && ls -1 | head -25")

    # ---- .env -------------------------------------------------------------
    secao(".env remoto (preserva o que ja existe)")
    public_url = os.environ.get("CV_PUBLIC_URL", "")
    if not public_url:
        log("aviso: CV_PUBLIC_URL vazia — os links de e-mail vao apontar para o valor atual")
    r.run(f"cd {remoto_dir} && bash scripts/preparar-env.sh {sh_quote(public_url)}")

    if tunnel_token:
        definir_env_remoto(cli, f"{remoto_dir}/.env",
                           {"CLOUDFLARE_TUNNEL_TOKEN": tunnel_token})
        log(f"CLOUDFLARE_TUNNEL_TOKEN gravado ({len(tunnel_token)} caracteres); "
            "cloudflared entra na stack")
    else:
        log("sem CV_TUNNEL_TOKEN — cloudflared fica de fora (so nginx do host)")

    # ---- build ------------------------------------------------------------
    secao("subindo a stack (o build leva alguns minutos)")
    r.run(f"{compose} up -d --build 2>&1 | tail -30", timeout=3600)

    secao("esperando a api ficar saudavel")
    saudavel = False
    for tentativa in range(40):
        rc, _, _ = r.run(
            f"{compose} exec -T api node -e "
            "\"fetch('http://127.0.0.1:3000/healthz')"
            ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
            check=False, mostrar=False, timeout=60,
        )
        if rc == 0:
            log(f"api saudavel ({tentativa * 5}s)")
            saudavel = True
            break
        time.sleep(5)
    if not saudavel:
        r.run(f"{compose} logs --tail=50 api", check=False, linhas=50)
        raise RuntimeError("a api nao ficou saudavel")

    # ---- provedor de e-mail (banco, cifrado) ------------------------------
    if os.environ.get("CV_SKIP_EMAIL") != "1":
        secao("provedor de e-mail")
        smtp_file = os.environ.get("CV_SMTP_FILE")
        smtp = ler_env_arquivo(smtp_file) if smtp_file else {}
        if not smtp.get("SMTP_USER") or not smtp.get("SMTP_PASS"):
            log("sem SMTP_USER/SMTP_PASS em CV_SMTP_FILE — pulando")
        else:
            sftp = cli.open_sftp()
            sftp.put(str(RAIZ / "scripts" / "configurar-email.mjs"),
                     "/tmp/configurar-email.mjs")
            sftp.close()
            r.run(f"{compose} cp /tmp/configurar-email.mjs api:/tmp/configurar-email.mjs")
            envs = " ".join([
                f"-e SMTP_HOST={sh_quote(smtp.get('SMTP_HOST', 'smtp.gmail.com'))}",
                f"-e SMTP_PORT={sh_quote(smtp.get('SMTP_PORT', '465'))}",
                f"-e SMTP_USER={sh_quote(smtp['SMTP_USER'])}",
                f"-e SMTP_PASS={sh_quote(smtp['SMTP_PASS'])}",
                f"-e SMTP_FROM_NAME={sh_quote(os.environ.get('CV_FROM_NAME', 'Codigo Vencedor'))}",
                f"-e SMTP_FROM_EMAIL={sh_quote(smtp.get('SMTP_FROM_EMAIL', smtp['SMTP_USER']))}",
            ])
            r.run(f"{compose} exec -T {envs} api node /tmp/configurar-email.mjs")
            r.run("rm -f /tmp/configurar-email.mjs", check=False, mostrar=False)

    # ---- verificacao ------------------------------------------------------
    secao("verificacao")
    r.run(f"{compose} ps", check=False)
    r.run("curl -s -o /dev/null -w 'healthz 3100: %{http_code}\\n' "
          "http://127.0.0.1:3100/healthz", check=False)
    r.run("curl -s http://127.0.0.1:3100/api/config | head -c 240; echo", check=False)
    r.run("curl -s -o /dev/null -w 'nginx :80 -> %{http_code}\\n' http://127.0.0.1/",
          check=False)
    if tunnel_token:
        # "Registered tunnel connection" nos logs e a prova de que a Cloudflare
        # aceitou o token; sem isso o dominio responde 502 e nada indica porque.
        r.run(f"{compose} logs --tail=15 cloudflared", check=False, linhas=15)

    secao("pronto")
    log(f"stack em {remoto_dir}")
    log(f"senha inicial do admin, na VPS: grep ADMIN_PASSWORD {remoto_dir}/.env")
    cli.close()


if __name__ == "__main__":
    main()
