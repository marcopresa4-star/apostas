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
   - `0008_allow_delete_teams_competitions.sql` (corrige a remoção de equipas/competições, que estava a ser bloqueada em silêncio)
   - `0009_cleanup_orphaned_tickets.sql` (limpeza única de jogos sem apostas associadas)
   - `0010_live_picks.sql` (adiciona apostas "live", com odd mínima de entrada)
   - `0011_live_pick_min_odd_only.sql` (simplifica a aposta live para só odd mínima)
   - `0012_bet_categories.sql` (cria a tabela `bet_categories` — tipos de aposta reutilizáveis, ex: "Over/Under")
   - `0013_pick_alert_minute.sql` (adiciona `alert_minute` às apostas live — alerta na dashboard ao atingir esse minuto de jogo)
   - `0014_pick_links.sql` (adiciona `sofascore_url` e `bookmaker_url` opcionais a cada aposta)
   - `0015_ticket_live_ended.sql` (adiciona `live_ended` aos jogos — marcar manualmente um jogo como terminado)
   - `0016_watched_matches.sql` (cria a tabela `watched_matches` — adicionar um widget de um jogo sem aposta)
   - `0017_community.sql` (cria `profiles` e a página Comunidade — publicar apostas para outros utilizadores verem)
   - `0018_fix_community_rls_recursion.sql` (corrige um erro de "infinite recursion" nas políticas criadas em 0017)
3. Vai a **Authentication → Users** e cria manualmente o teu utilizador (email + password). Não há página pública de registo — só tu (ou quem tu decidires) é que tens conta.
   - **Depois de correr o `0017_community.sql`**, torna-te admin: no SQL Editor, corre
     `insert into profiles (id, role) select id, 'admin' from auth.users where email = 'o-teu-email@exemplo.com' on conflict (id) do update set role = 'admin';`
     (substitui pelo teu email de login). Sem isto ficas com acesso só à página Comunidade, como um utilizador normal.
   - Para dar acesso a outra pessoa só à Comunidade, cria a conta dela em **Authentication → Users** da mesma forma — não precisa de nenhum passo extra (fica "user" por omissão).
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
- **picks** — cada aposta feita sobre um `ticket`: o tipo (`pre_jogo` ou `live`), a seleção (ex: "Benfica vence"), a odd (pré-jogo) ou odd mínima (live), a categoria opcional, a razão, e o estado (`pending`, `green`, `red`, `void`). Um jogo pode ter várias apostas associadas. Tudo é restrito ao utilizador autenticado via RLS.
- **pick_images** — os prints anexados a uma aposta (uma aposta pode ter vários), guardados no bucket privado `game-images`.
- **bet_categories** — tipos de aposta reutilizáveis (ex: "Over/Under", "Ambas Marcam"), criados ao registar uma aposta e reaproveitados depois; usados para o ranking "Tipos de aposta" no Dashboard.

No formulário de "Nova aposta", os campos de competição e equipas são pesquisáveis; se não encontrares o que procuras, há uma opção para criar uma nova entrada (nome + país) sem sair do formulário. Depois de guardares um jogo, podes adicionar mais apostas a esse mesmo jogo diretamente na lista principal.
