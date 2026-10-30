# QueueFlow — Queue Management for Clinics & Salons

QueueFlow is a web app that manages a waiting line using **token numbers**.
It handles both **walk-in customers** and **scheduled appointments** in one fair queue.

- **Staff** log in to add customers, see the queue, call the next customer and mark services complete.
- **Customers** open a public page, with no login, to see their position in the queue and their estimated waiting time. Customer names are **never** shown publicly, only token numbers like `W-012` or `A-004`.
- Every screen updates **live**. When staff call someone on one device, all other staff screens, the waiting-room board and customers' phones update within about a second.

**Built with:** React + Vite (frontend), Supabase (database, login, realtime), Vercel (hosting).

---

## 🔗 Live demo

**App:** https://YOUR-APP.vercel.app

| Page | Link | Login needed? |
|---|---|---|
| Public queue board | `/` | No |
| Check my token | `/t/W-012` (or type the token on the board) | No |
| Staff login | `/staff/login` | Yes |

**Demo staff account** (fictional, for review only):
- Email: `reviewer@queueflow.test`
- Password: `Review@2026`

After logging in, open **Settings & demo data → Load demo data** to fill the queue with fictional customers.

---

## ✨ Features

**For staff**
- Add a customer as a **Walk-in** or an **Appointment**. An appointment can be "here now" or booked ahead and checked in later.
- See the queue in call order, with token, name, booking type, arrival time, estimated call time, and the reason for each position.
- **Call next customer.** The app picks who is next automatically.
- **Complete**, **No-show**, **Undo call**, **Cancel**, and **Call now** (manual override for urgent cases).
- See the average service time, the number of people waiting, and a wait quote for a new walk-in.
- Settings: number of open counters, default service time, walk-in target wait, appointment grace period.

**For customers**
- A public board showing "Now serving" and "Up next", with estimated waits.
- A personal token page showing position, estimated wait and expected time. It changes to "Please go to Counter 1" when called.

---

## ⚖️ How the queue is ordered (walk-ins vs appointments)

Every customer gets a **promised time**:
- **Appointment:** their booked time, if they check in no more than **10 minutes late**.
- **Walk-in:** their arrival time **+ 30 minutes**.

**The customer with the earliest promised time is called next.**

This means:
- Walk-ins are always served **first come, first served** among themselves.
- On-time appointments are served **at their booked time**.
- An appointment **cannot push a walk-in back without limit**. Once a walk-in has waited about 30 minutes, they go first.
- An appointment that arrives **more than 10 minutes late** joins the queue like a walk-in.

Both numbers (30 and 10) can be changed in **Settings**.

**Estimated waiting time** is based on the real average length of recent services, starting at 15 minutes until real data exists, and on the number of open counters.

Full reasoning, assumptions and trade-offs are in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## 🚀 How to run it on your computer

### What you need
- **Node.js 18 or newer:** https://nodejs.org
- A free **Supabase** account: https://supabase.com

### Step 1: Download the code and install
```bash
git clone (https://github.com/NafisaJashim821/QueueFlow.git)
cd queueflow-queue-management
npm install
```

### Step 2: Set up the database in Supabase
1. Create a **New project** in Supabase and wait for it to finish setting up.
2. Open **SQL Editor → New query**, paste the whole contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   You should see "Success". The tables `tickets`, `staff`, `queue_settings` and `queue_signal` now exist.
3. Create a staff login: go to **Authentication → Users → Add user → Create new user**, enter an email and password, and tick **Auto Confirm User**.
4. Allow that user to act as staff. In the **SQL Editor**, run this with your email:
   ```sql
   insert into public.staff (user_id, display_name)
   select id, 'Front desk' from auth.users where email = 'your-email@example.com'
   on conflict do nothing;
   ```

### Step 3: Connect the app to Supabase
1. In Supabase, go to **Project Settings → API Keys** and copy:
   - the **Project URL**, for example `https://abcdefgh.supabase.co`. Don't include `/rest/v1/` at the end.
   - the **Publishable key** (`sb_publishable_...`) or the legacy **anon public** key (`eyJ...`).
2. In the project folder, create a file named **`.env.local`** containing:
   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxx
   ```
   ⚠️ Never use the **secret / service_role** key.

### Step 4: Start the app
```bash
npm run dev
```
Open the address shown in the terminal, usually **http://localhost:5173**.

- Staff: go to `/staff/login` and sign in with the user from Step 2.
- Click **Settings & demo data → Load demo data**.
- Open `/` in another browser window to see the public board update live.

To test on your phone (same Wi-Fi), run `npm run dev -- --host` and open the **Network** address it prints.

---

## ☁️ Deploy to Vercel

1. Push the code to GitHub.
2. Go to https://vercel.com/new and **import** the repository. Vercel detects Vite automatically.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, with the same values as `.env.local`.
4. Click **Deploy**.
5. In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to your Vercel link.

If you change the environment variables later, **redeploy** for them to take effect.

---

## 🧪 Tests

```bash
npm test          # queue logic + page tests
npm run test:sql  # database security & queue order tests
```

Manual test checklist: [`docs/TESTING.md`](docs/TESTING.md).

---

## 🔒 Security & privacy
- Only the public (publishable/anon) key is used in the browser.
- Database rules (RLS) block all direct reads and writes. Only staff accounts listed in the `staff` table can change the queue.
- The public view receives token numbers only, never names or notes.
- All sample data is fictional.

---

## 📁 Project structure
```
src/pages/          Public board, token page, staff login, staff dashboard
src/components/     UI pieces (queue table, add-customer form, counter panel, settings)
src/lib/            Queue logic (queueEngine.js) and Supabase connection
src/hooks/          Live data sync and login
supabase/           Database schema (schema.sql), add-staff script, database tests
docs/               Design decisions, testing, AI usage log
```

## 📄 Documentation
- [`docs/DESIGN.md`](docs/DESIGN.md): assumptions, queue logic, waiting-time calculation
- [`docs/TESTING.md`](docs/TESTING.md): how it was tested
- [`docs/AI_USAGE_LOG.md`](docs/AI_USAGE_LOG.md): AI prompts used and changes made
