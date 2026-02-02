# LeedsCRM (TikunCRM)

Multi-level CRM for dealerships: manage leads, teams, communications, follow-ups, and analytics with role-based access (Super Admin, Dealership Owner/Admin, Salesperson).

---

## Tech Stack

- **Backend:** FastAPI, PostgreSQL, SQLAlchemy (async), JWT, Alembic
- **Frontend:** Next.js 16, React 19, Tailwind CSS, Zustand, Radix UI
- **Features:** RBAC, lead assignment, email (SMTP/IMAP), follow-ups, notifications, Google Sheets sync, dealership timezones

---

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
# Set DATABASE_URL in .env, then:
alembic upgrade head
uvicorn app.main:app --reload
```

API: `http://localhost:8000`  
Docs: `http://localhost:8000/docs`

### 2. Frontend

```bash
cd frontend
npm install
# Set NEXT_PUBLIC_API_URL in .env (default: http://localhost:8000/api/v1)
npm run dev
```

App: `http://localhost:3000`

### 3. Seed demo data (optional)

```bash
cd backend
python -m scripts.seed_demo
```

Creates Super Admin, 3 dealerships, admins, salespersons, and sample leads. **Default credentials:** see [docs/CREDENTIALS.md](docs/CREDENTIALS.md).

---

## Default Credentials (after seed)

| Role              | Email                              | Password   |
|-------------------|-------------------------------------|------------|
| **Super Admin**   | `admin@leedscrm.com`                | `admin123` |
| **Dealership Admin** | `john.mitchell@premiummotors.com` (and 2 more) | `dealer123` |
| **Salesperson**   | e.g. `sarah.jenkins1@premiummotors.com` | `sales123` |

Full list and capabilities: **[docs/CREDENTIALS.md](docs/CREDENTIALS.md)**.

---

## Using the CRM – User Guide

### Logging in

1. Open the app (e.g. `http://localhost:3000` or your Netlify URL).
2. Go to **Login** and enter your **email** and **password**.
3. Sessions last **30 days**; you stay logged in until you sign out or the token expires.

---

### Roles and access

- **Super Admin:** All dealerships, all leads, create/edit dealerships, assign leads to dealerships, integrations (e.g. Google Sheets), system-wide analytics.
- **Dealership Owner / Dealership Admin:** Their dealership only: team, leads, settings, follow-ups, communications, analytics. Can create leads and assign to salespersons.
- **Salesperson:** Only leads assigned to them; can log calls, add notes, use communications and follow-ups. Cannot create leads.

---

### Dashboard

- **Super Admin:** System-wide stats (dealerships, leads, users), quick links.
- **Dealership Admin/Owner:** Dealership stats, team and lead summaries.
- **Salesperson:** My leads summary, upcoming follow-ups, recent activity.

---

### Leads

- **Leads** – List of leads (for your dealership or all, depending on role). Filter by status, search, open a lead for details.
- **Unassigned Leads** – Pool of leads not yet assigned to a dealership (Super Admin) or not assigned to a salesperson (Dealership Admin). Use **Assign to Dealership** or **Assign to Salesperson**.
- **Lead detail** – View/edit lead, timeline (notes, calls, emails, status changes), **Schedule follow-up**, **Assign/Reassign**, log call, add note, send email.

Only **Dealership Admin** or **Owner** can create new leads; Salespersons cannot.

---

### Follow-ups

- **Follow-ups** – List of scheduled follow-ups (pending, overdue, completed). Filter by status.
- Schedule from **Lead detail** or from the Follow-ups page. Complete with optional notes.

---

### Communications

- Inbox-style view: sent and received emails linked to leads.
- Compose email (rich text), use templates, link to lead. Configure SMTP/IMAP in **Settings → Email config** (per user or dealership as set up).

---

### Notifications

- **Notifications** – In-app list (e.g. lead assigned, new email). Mark as read, filter by type, delete.

---

### Team (Dealership Admin/Owner)

- List users for the dealership (Owners, Admins, Salespersons).
- Add users (Dealership Admin/Owner), edit roles. Super Admin can manage users across dealerships.

---

### Dealerships (Super Admin only)

- List all dealerships, create new dealership (with optional owner), edit name/contact/timezone, activate/deactivate.

---

### Settings

- **Profile** – Name, phone, email (and dealership email if applicable).
- **Dealership** – Dealership details and timezone (Admin/Owner).
- **Email config** – SMTP/IMAP for sending/receiving (per user or as configured).
- **Email templates** – Create/edit templates for emails (variables supported).
- **Dealership email** – Dealership-level email configuration (if used).

All date/time shown in the app use the **dealership timezone** where applicable.

---

### Integrations (Super Admin)

- **Google Sheets** – Configure sync of leads from a Google Sheet (URL). New rows become unassigned leads; sync runs on a schedule.

---

## Deployment

- **Frontend (Netlify):** See [docs/NETLIFY-DEPLOY.md](docs/NETLIFY-DEPLOY.md). Set `NEXT_PUBLIC_API_URL` to your backend API URL.
- **Backend:** Host FastAPI (e.g. Azure, AWS, Railway). Set `DATABASE_URL`, `SECRET_KEY`, CORS, and env vars. Run migrations on deploy.

---

## Project structure

```
LeedsCrm/
├── backend/          # FastAPI app, migrations, scripts
├── frontend/          # Next.js app
├── docs/
│   ├── CREDENTIALS.md # Default login credentials
│   └── NETLIFY-DEPLOY.md
├── netlify.toml       # Netlify build (frontend)
└── README.md
```

---

## Docs

- **[docs/CREDENTIALS.md](docs/CREDENTIALS.md)** – Super Admin, Dealership Admin, and Salesperson default credentials and how to seed.
- **[docs/NETLIFY-DEPLOY.md](docs/NETLIFY-DEPLOY.md)** – Deploy frontend to Netlify from repo root or CLI.
