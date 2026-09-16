# Apostas

Site pessoal para registar apostas desportivas: liga/competição, equipa da casa, equipa de fora, dia e hora do jogo, razão da aposta, e o resultado (Green / Red / Devolvida). Equipas e competições estão sempre ligadas a um país (existe também o país "Mundo" para competições internacionais). Se uma equipa ou competição não existir, podes criá-la diretamente no formulário.

Stack: [Next.js](https://nextjs.org) (App Router) + [Supabase](https://supabase.com) (Postgres + Auth), pronto a fazer deploy no [Vercel](https://vercel.com).

## 1. Criar o projeto Supabase

1. Cria uma conta/projeto em [supabase.com](https://supabase.com).
2. No dashboard do projeto, vai a **SQL Editor** e corre, por esta ordem, o conteúdo de cada ficheiro em `supabase/migrations/`:
   - `0001_schema.sql` (cria as tabelas base e as políticas de RLS)
   - `0002_seed_countries.sql` (preenche a tabela `countries` com todos os países do mundo + "Mundo")
   - `0003_add_bet_selection.sql` (adiciona o campo "Aposta")
   - `0004_tickets_and_picks.sql` (separa o jogo, "ticket", das apostas individuais, "picks", para permitir mais que uma aposta por jogo)
   - `0005_ticket_images.sql` (cria o bucket de Storage `game-images` e o campo para anexar um print a cada jogo)
   - `0006_add_pick_odd.sql` (adiciona o campo "Odd" a cada aposta)
   - `0007_multiple_pick_images.sql` (permite anexar mais do que um print a cada aposta)
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
- **tickets** — o jogo em si: competição, equipa da casa, equipa de fora, dia e hora.
- **picks** — cada aposta feita sobre um `ticket`: a seleção (ex: "Benfica vence"), a odd, a razão, e o estado (`pending`, `green`, `red`, `void`). Um jogo pode ter várias apostas associadas. Tudo é restrito ao utilizador autenticado via RLS.
- **pick_images** — os prints anexados a uma aposta (uma aposta pode ter vários), guardados no bucket privado `game-images`.

No formulário de "Nova aposta", os campos de competição e equipas são pesquisáveis; se não encontrares o que procuras, há uma opção para criar uma nova entrada (nome + país) sem sair do formulário. Depois de guardares um jogo, podes adicionar mais apostas a esse mesmo jogo diretamente na lista principal.
