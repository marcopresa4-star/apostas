# Apostas

Site pessoal para registar apostas desportivas: liga/competição, equipa da casa, equipa de fora, dia e hora do jogo, razão da aposta, e o resultado (Green / Red / Devolvida). Equipas e competições estão sempre ligadas a um país (existe também o país "Mundo" para competições internacionais). Se uma equipa ou competição não existir, podes criá-la diretamente no formulário.

Stack: [Next.js](https://nextjs.org) (App Router) + [Supabase](https://supabase.com) (Postgres + Auth), pronto a fazer deploy no [Vercel](https://vercel.com).

## 1. Criar o projeto Supabase

1. Cria uma conta/projeto em [supabase.com](https://supabase.com).
2. No dashboard do projeto, vai a **SQL Editor** e corre, por esta ordem, o conteúdo de:
   - `supabase/migrations/0001_schema.sql` (cria as tabelas `countries`, `competitions`, `teams`, `bets` e as políticas de RLS)
   - `supabase/migrations/0002_seed_countries.sql` (preenche a tabela `countries` com todos os países do mundo + "Mundo")
3. Vai a **Authentication → Users** e cria manualmente o teu utilizador (email + password). Não há página pública de registo — o login é só para ti.
4. Vai a **Project Settings → API** e copia:
   - `Project URL`
   - `anon public` key

## 2. Configurar variáveis de ambiente

Copia `.env.local.example` para `.env.local` e preenche com os valores do passo anterior:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxxxxx
```

## 3. Correr localmente

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) — vais ser redirecionado para `/login`.

## 4. Deploy no Vercel

1. Publica este repositório no GitHub (usa o botão **Publish to GitHub** no VS Code, ou `git remote add origin ...` + `git push`).
2. Em [vercel.com](https://vercel.com), faz **Import Project** a partir do repositório GitHub.
3. Em **Environment Variables**, adiciona `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` com os mesmos valores do `.env.local`.
4. Deploy. A partir daí, cada push ao branch principal faz um novo deploy automaticamente.

## Estrutura de dados

- **countries** — todos os países do mundo + "Mundo" (para competições internacionais).
- **competitions** — ligas/competições, cada uma ligada a um país.
- **teams** — equipas, cada uma ligada a um país.
- **bets** — cada aposta: competição, equipa da casa, equipa de fora, dia, hora, razão, e estado (`pending`, `green`, `red`, `void`). Cada aposta pertence ao utilizador autenticado (RLS restringe leitura/escrita ao dono).

No formulário de "Nova aposta", os campos de competição e equipas são pesquisáveis; se não encontrares o que procuras, há uma opção para criar uma nova entrada (nome + país) sem sair do formulário.
