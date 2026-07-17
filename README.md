# Okrajovka

Online tahová desková hra pro 4–6 hráčů včetně AI botů. Frontend je statická HTML/CSS/JavaScript aplikace, serverové operace běží jako Vercel Functions a sdílená data používají Supabase Auth, Postgres a Realtime.

## Architektura

- `outputs/` – nasazovaný frontend a existující herní pravidla.
- `api/` – veřejné serverové endpointy pro místnosti a tahy.
- `server/` – ověření identity, práce s místnostmi a serverové provedení hry.
- `supabase/migrations/` – tabulky, RLS, realtime a atomické databázové funkce.
- `tests/` – pravidla hry, multiplayerové bezpečnostní kontroly a volitelný E2E scénář.

Autoritativní stav je v `game_states.state`. Klient drží jen UI stav, například hover, vybraný cíl a animaci. Každý tah server znovu ověří existujícími moduly `game-rules.js` a `game-session.js`. Zápis do databáze používá očekávanou verzi a idempotency key.

## 1. Vytvoření Supabase projektu

1. Vytvoř nový projekt na Supabase.
2. V `Authentication → Providers` zapni Anonymous Sign-Ins.
3. Zkopíruj Project URL, publishable/anon key a service role key.
4. Service role key nikdy nevkládej do browseru ani do `runtime-config.js`.

## 2. Databázová migrace

V Supabase SQL Editoru spusť celý soubor:

`supabase/migrations/202607160001_multiplayer.sql`

Migrace vytvoří:

- `rooms`
- `room_players`
- `game_states`
- `game_actions`
- RLS politiky pro čtení pouze členy místnosti
- server-only databázové funkce pro start a compare-and-swap zápis tahu
- Realtime publikaci potřebných tabulek

## 3. Realtime

Migrace přidá `rooms`, `room_players` a `game_states` do publikace `supabase_realtime`. V Supabase Dashboardu ověř v `Database → Replication`, že jsou tyto tři tabulky aktivní.

## 4. Proměnné prostředí

Zkopíruj `.env.example` do `.env.local` a vyplň:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=sb_publishable_YOUR_PUBLIC_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
PUBLIC_APP_URL=http://localhost:3000
```

`SUPABASE_ANON_KEY` je veřejná hodnota vložená při buildu do `outputs/runtime-config.js`. `SUPABASE_SERVICE_ROLE_KEY` je dostupný pouze serverovým funkcím.

## 5. Lokální spuštění

Vyžaduje Node.js 22+ a pnpm.

```bash
pnpm install
pnpm build
pnpm start
```

Otevři adresu vypsanou `vercel dev`. Obyčejné otevření `file://.../outputs/index.html` neumí spouštět API funkce a slouží pouze jako lokální demo.

## 6. Testy

```bash
pnpm lint
pnpm test
pnpm build
```

Produkční E2E test se dvěma oddělenými browser contexts:

```bash
pnpm add -D playwright
pnpm exec playwright install chromium
E2E_BASE_URL=https://tvoje-domena.cz pnpm test:e2e
```

E2E vyžaduje nakonfigurovaný Supabase projekt a běžící nasazení.

## 7. Nasazení na Vercel

1. Importuj tento adresář jako nový Vercel projekt.
2. Framework preset ponech `Other`.
3. Build command je `pnpm build`.
4. Output directory je `outputs`.
5. Přidej všechny čtyři proměnné z `.env.example`.
6. Pro `PUBLIC_APP_URL` použij finální HTTPS doménu.
7. Spusť deploy.
8. V Supabase Auth nastav Site URL na produkční doménu.
9. Do povolených redirect URL přidej produkční doménu a lokální Vercel Dev URL.

Soubor `vercel.json` zajišťuje přímé otevření `/game/:roomId` a serverové API v `/api`.

Netlify může hostovat statický frontend, ale serverové funkce v tomto projektu jsou připravené pro Vercel. Nejjednodušší a doporučené nasazení celé aplikace je proto Vercel.

## 8. Kontrola produkce

1. Otevři kořenovou URL.
2. Zadej přezdívku a klikni na „Vytvořit hru“.
3. Zkopíruj zobrazený odkaz `/game/ABC123`.
4. Otevři odkaz v anonymním okně nebo na druhém zařízení.
5. Zadej druhou přezdívku.
6. Na obou zařízeních ověř stejný seznam hráčů.
7. Vyber postavy.
8. Hostitel připraví a spustí hru.
9. Ověř, že tah jednoho hráče se realtime zobrazí druhému.
10. Obnov stránku a ověř, že nevznikl duplicitní hráč.

## Bezpečnost

- Anonymní hráč dostane stabilní Supabase Auth user ID uložené v browser session.
- Přímé zápisy do herních tabulek jsou pro `authenticated` a `anon` role zakázané.
- RLS dovoluje číst pouze místnosti, jejichž je uživatel členem.
- Server ověřuje členství, hostitele, fázi hry, aktivního hráče a platnost akce.
- Databáze zamkne aktuální stav, ověří jeho verzi a odmítne starší nebo duplicitní tah.
- Service role key existuje pouze v serverovém prostředí.

## Omezení bez backendové konfigurace

Pokud nejsou nastavené Supabase proměnné, aplikace zachová původní lokální demo. Veřejný multiplayer, sdílené URL, reconnect a realtime vyžadují dokončené kroky výše.
Deployment refresh
nowe pleas
