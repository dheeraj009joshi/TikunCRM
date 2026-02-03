# LeedsCRM – Default Login Credentials

These credentials are created when you run the **database seed script** (`backend/scripts/seed_demo.py`). If you have not run the seed, create a Super Admin via signup (first user) or run the seed.

---

## Super Admin

| Field     | Value                |
|----------|----------------------|
| **Email**    | `admin@leedscrm.com` |
| **Password** | `admin123`           |
| **Role**     | Super Admin          |

**Capabilities:** Full access to all dealerships, users, leads, and settings. Can create dealerships, assign leads to dealerships, view all analytics, and manage integrations (e.g. Google Sheets).

---

## Dealership Admins (after running seed)

The seed creates **3 dealerships** with one Dealership Admin each. All use the same password.

| Dealership              | Email                              | Password   |
|-------------------------|------------------------------------|------------|
| Premium Motors North    | `john.mitchell@premiummotors.com`  | `dealer123` |
| Premium Motors Downtown | `lisa.parker@premiummotors.com`    | `dealer123` |
| Premium Motors South    | `robert.williams@premiummotors.com`| `dealer123` |

**Capabilities:** Manage their dealership (users, leads, settings, team, follow-ups, communications). Cannot see other dealerships or create new dealerships.

---

## Salespersons (after running seed)

Each dealership gets **5 salespersons**. All use the same password.

| Password   | Example email (one of 15)           |
|-----------|--------------------------------------|
| `sales123` | `sarah.jenkins1@premiummotors.com`  |

**Capabilities:** View and manage only leads assigned to them; log calls/notes; use communications and follow-ups for their leads. Cannot create leads (only Dealership Admin/Owner can).

---

## How to create these users

### Option 1: Super Admin only (production / fix login)

If login fails with "Incorrect email or password" (e.g. production DB was never seeded), run this **from your machine** with `backend/.env` pointing to the **same database** as your API (e.g. production):

```bash
cd backend
python -m scripts.seed_super_admin
```

This creates or **resets** the Super Admin `admin@leedscrm.com` with password `admin123`. Safe to run multiple times (idempotent).

### Option 2: Full demo data (development)

From the **backend** directory:

```bash
cd backend
python -m scripts.seed_demo
```

Ensure the database is running and migrations are applied first. The script creates:

- 1 Super Admin  
- 3 Dealerships  
- 3 Dealership Admins  
- 15 Salespersons (5 per dealership)  
- 100+ sample leads  

**Seeding production:** Use the same `DATABASE_URL` in `backend/.env` as your production API (e.g. Azure PostgreSQL). Then run `python -m scripts.seed_super_admin` (or `seed_demo`) from your machine so the script connects to that database.

**Important:** Change default passwords in production. These credentials are for **development and demo only**.
