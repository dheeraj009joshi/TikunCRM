# Deploy LeedsCRM Frontend to Netlify

This guide covers deploying the **frontend only** to Netlify. The backend API should already be hosted elsewhere (e.g. `https://leedsapi.tikuntech.com/api/v1`).

---

## Option 1: Deploy via Netlify UI (recommended)

### 1. Push your code to Git

Push your repo to GitHub, GitLab, or Bitbucket.

### 2. Add site in Netlify

1. Go to [netlify.com](https://www.netlify.com) and sign in.
2. Click **Add new site** → **Import an existing project**.
3. Choose your Git provider and authorize Netlify.
4. Select the **LeedsCrm** repository.

### 3. Configure build settings

Netlify should read these from `netlify.toml`. If not, set manually:

| Setting | Value |
|--------|--------|
| **Base directory** | `frontend` |
| **Build command** | `npm run build` |
| **Publish directory** | *(leave default; Netlify Next.js plugin sets it)* |

### 4. Set environment variables

In **Site settings** → **Environment variables** → **Add a variable** (or **Add from .env**):

| Variable | Value | Scopes |
|----------|--------|--------|
| `NEXT_PUBLIC_API_URL` | `https://leedsapi.tikuntech.com/api/v1` | All |

Optional:

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_APP_NAME` | `LeedsCRM` |
| `NEXT_PUBLIC_APP_ENV` | `production` |

### 5. Deploy

Click **Deploy site**. Netlify will install dependencies, run `npm run build` in `frontend/`, and deploy the Next.js app.

---

## Option 2: Deploy with Netlify CLI

```bash
# Install Netlify CLI (once)
npm install -g netlify-cli

# Log in
netlify login

# From repo root: link to a new site (or existing)
netlify init

# When prompted:
# - Create & configure a new site
# - Team: your team
# - Site name: e.g. leedscrm
# - Build command: npm run build
# - Directory to deploy: frontend (or leave blank if base is in netlify.toml)
# - Add NEXT_PUBLIC_API_URL when asked, or in Netlify UI later

# Deploy
netlify deploy --prod
```

Ensure `NEXT_PUBLIC_API_URL` is set in the Netlify dashboard (Site settings → Environment variables) before production deploy.

---

## Project structure (for Netlify)

- Repo root contains `netlify.toml` and `frontend/`.
- **Base directory** is `frontend`, so all build commands run from `frontend/`.
- Backend is **not** deployed to Netlify; it runs at `https://leedsapi.tikuntech.com`.

---

## Troubleshooting

- **Build fails:** Check the build log. Ensure **Base directory** is `frontend` and **Build command** is `npm run build`.
- **API calls fail / CORS:** Backend at `leedsapi.tikuntech.com` must allow your Netlify domain in CORS (e.g. `https://your-site.netlify.app`).
- **404 on refresh:** Netlify’s Next.js plugin should handle this; if not, add a catch-all redirect in Netlify (Redirects) or in `netlify.toml`.
