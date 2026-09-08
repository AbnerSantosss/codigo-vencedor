# vendor/

Cópia local do Chart.js (build UMD minificado).

Está versionado no repositório de propósito: a CSP do painel é
`script-src 'self' 'nonce-…'` e não libera nenhum CDN. Servir daqui evita
abrir uma exceção na política só para carregar uma biblioteca de gráficos.

Para atualizar:

    npm install chart.js@latest
    cp node_modules/chart.js/dist/chart.umd.min.js admin/vendor/chart.min.js
