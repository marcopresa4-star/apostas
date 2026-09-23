# SofaScore scraper local (CloakBrowser)

Lê o estado dos jogos (resultado, minuto, cartões) no SofaScore para a
calculadora live e para o “Ao vivo agora”. Corre **só na tua máquina** —
o Vercel não consegue correr browsers stealth.

## Uma vez

```bash
cd scraper
npm install
npx cloakbrowser login   # chave grátis via GitHub (build Chromium 151 atual).
                         # Sem chave funciona na mesma, no build antigo grátis.
```

## Sempre que fores usar o live (sem janela, headless por omissão)

```bash
cd scraper
npm start
```

Se um dia for preciso resolver um desafio à mão, arranca uma vez com janela visível (`SOFASCORE_HEADLESS=0 npm start`), resolve e volta ao normal.

- Na primeira vez abre uma janela visível do Chromium. Se aparecer um desafio
  Cloudflare, resolve-o à mão e deixa o processo a correr — a autorização fica
  guardada em `scraper/.cloak-profile/` e nas próximas vezes já não pede.
- Depois podes minimizar a janela. Não a feches enquanto usares o live.
- Saúde: http://127.0.0.1:9323/health

## Ligar a app

No `.env.local` da raiz (ver `.env.local.example`):

```
SOFASCORE_SCRAPER_URL=http://127.0.0.1:9323
```

A app chama o scraper através de `/api/sofascore/event?id=` e
`/api/sofascore/live`. Com o scraper desligado essas rotas devolvem
`503 scraper-offline` e a calculadora pede para escreveres o minuto e o
resultado à mão — nada parte.

## O que o scraper faz (e não faz)

- Faz `GET /event?id=` → `{ event, incidents }` em bruto (cache 30s) e
  `GET /live` → `{ events }` (cache 60s), usando o `fetch` dentro da própria
  página do SofaScore (cookies de autorização incluídos).
- Faz `GET /raw?path=/search/all&q=benfica` → passthrough genérico à JSON API
  dentro da página (só paths `/api/v1/...`; só para uso local). Usado pelo
  histórico da fase 1: épocas, jornadas, classificações, eventos por equipa.
- A normalização para o estado live (`LiveGameState`) vive na app, em
  `src/lib/sofascore.ts`, para ser testável sem browser.
- Não faz login no SofaScore, não resolve captchas sozinho, não roda odds de
  casas de apostas.

## Alternativa avaliada: camofox-browser

O `camofox-browser` (Firefox/Camoufox + servidor REST em `:9377`, sessões
isoladas, login visual via VNC) é melhor se um dia quiseres servir vários
utilizadores/agentes a partir de uma box partilhada (Raspberry Pi, VPS de $5).
Para um só utilizador local, o CloakBrowser é um único processo Node com API
Playwright direta — menos peças para gerir.
