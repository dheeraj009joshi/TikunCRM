# Clone data to Neon DB

Copy data from a **source** database into your **Neon** (target) database. If the source still has the old lead schema (contact fields and `status` on `leads`), the script upgrades the data to the new structure (customers + lead_stages + leads with `customer_id` / `stage_id`) before writing to Neon.

## 1. Use Neon as your target database

In `.env` set the **target** (Neon) URL. You can override it with `TARGET_DATABASE_URL` when running the script:

```env
# Optional: default target when cloning
TARGET_DATABASE_URL=postgresql+asyncpg://user:pass@ep-xxx.neon.tech/neondb?ssl=require
```

## 2. Run migrations on Neon first (required)

Neon must have the **new** schema (customers, lead_stages, leads with customer_id/stage_id). From `backend/`:

```bash
# Point at Neon and run migrations
TARGET_DATABASE_URL="postgresql+asyncpg://..." alembic upgrade head
```

Or set `DATABASE_URL` in `.env` to the Neon URL and run:

```bash
alembic upgrade head
```

## 3. Clone from source into Neon

Set the **source** DB URL (where your data lives now, e.g. Azure or local PostgreSQL) and run the script. Target defaults to `TARGET_DATABASE_URL` or `DATABASE_URL`.

```bash
cd backend

# Example: source = Azure; target = Neon (from env or TARGET_DATABASE_URL)
export SOURCE_DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/dbname?ssl=require"
python -m scripts.clone_to_neon
```

With inline env:

```bash
SOURCE_DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/dbname?ssl=require" python -m scripts.clone_to_neon
```

The script will:

- Copy all **dealerships** (preserving IDs).
- Copy all **users** (preserving IDs and password hashes).
- **Leads**:
  - **If source has OLD schema** (leads have `first_name`, `last_name`, `status`, etc.): reads leads with raw SQL, deduplicates into **customers** (by phone then email), maps old `status` to **lead_stages**, and inserts customers then leads into Neon (preserving lead IDs so related data can be wired later).
  - **If source has NEW schema** (leads have `customer_id`, `stage_id`): copies **customers** and **leads** into Neon, mapping source stage IDs to target stage IDs by name.
- Ensures a **super admin** exists in Neon: `admin@leedscrm.com` / `admin123`.

## 4. Use the app with Neon

Set `DATABASE_URL` in `.env` to the Neon URL and start the backend as usual. Log in with any cloned user or `admin@leedscrm.com` / `admin123`.

---

## 5. Full flow: convert source data, then re-push to source (optional)

If you want the **source** DB to end up with the same converted data and schema as Neon (e.g. after cloning and making fixes in Neon, or to make both DBs identical):

1. **Migrations on Neon** (upgraded DB) so it has the new schema.
2. **Clone source → Neon** so Neon has the converted data (`python -m scripts.clone_to_neon`).
3. **Migrations on source** so the source DB has the same schema as Neon:
   ```bash
   SOURCE_DATABASE_URL="postgresql+asyncpg://..." python -m scripts.run_migrations_source
   ```
   If the source had the old lead schema, this run will apply the customer/lead_stages migration (and may convert data in place; UUIDs will differ from Neon).
4. **Re-push Neon → source** so the source gets the exact same core data as Neon:
   ```bash
   SOURCE_DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/source_db"
   TARGET_DATABASE_URL="postgresql+asyncpg://...@...neon.tech/neondb?ssl=require"
   python -m scripts.push_neon_to_source
   ```
   **Warning:** This **overwrites** all app data on source: dealerships, users, customers, leads, and all other tables (activities, follow_ups, appointments, call/email/sms/whatsapp logs, showroom_visits, notifications, fcm_tokens, schedules, email/whatsapp config and templates, etc.). **Take a full backup of the source DB before running** (e.g. `scripts/backup_db_to_file.py` or your provider’s backup).

Use re-push when you want source and Neon to match after cloning and optionally editing data in Neon.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Run `alembic upgrade head` against Neon so it has the new schema. |
| 2 | Set `SOURCE_DATABASE_URL` to your current DB and run `python -m scripts.clone_to_neon`. |
| 3 | Set `DATABASE_URL` to Neon and run the app. |
| 4 (optional) | Run migrations on source (`run_migrations_source`), then re-push from Neon to source (`push_neon_to_source`) after backing up source. |
