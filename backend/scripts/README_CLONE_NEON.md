# Clone data to Neon DB for local use

## 1. Use Neon as your local database

In `.env` set:

```env
DATABASE_URL=postgresql+asyncpg://neondb_owner:npg_UTdSwB9IWGu3@ep-floral-resonance-a18h7knm-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

## 2. Run migrations on Neon (first time only)

From `backend/`:

```bash
alembic upgrade head
```

## 3. Clone users, leads, and dealerships into Neon

Copy from your **existing** DB (e.g. Azure or current PostgreSQL) **into** Neon.

Set the **source** DB (where the data lives now) and optionally the **target** (Neon):

```bash
# Example: source is your Azure DB; target defaults to Neon
export SOURCE_DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/dbname?ssl=require"
# TARGET_DATABASE_URL defaults to Neon if not set
python -m scripts.clone_to_neon
```

Or with inline env:

```bash
SOURCE_DATABASE_URL="postgresql+asyncpg://mindsurvey:Dheeraj2006@mindsurvey.postgres.database.azure.com:5432/LeedsCrm?ssl=require" python -m scripts.clone_to_neon
```

The script will:

- Copy all **dealerships** (preserving IDs)
- Copy all **users** (preserving IDs and password hashes)
- Copy all **leads** (preserving IDs and FKs)
- Ensure a **super admin** exists in Neon: `admin@leedscrm.com` / `admin123`

## 4. Use the app with Neon

Keep `DATABASE_URL` in `.env` pointing to Neon and start the backend as usual. You can log in with any cloned user or with `admin@leedscrm.com` / `admin123`.
