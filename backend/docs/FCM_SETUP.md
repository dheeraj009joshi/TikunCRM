# Firebase Cloud Messaging (FCM) HTTP V1 – Setup Guide

TikunCRM supports push notifications via **Firebase Cloud Messaging (FCM) HTTP API V1**. This guide explains how to get the service account JSON file from Firebase and configure the backend.

---

## 1. Create or use a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or select an existing project).
3. Follow the steps (name, Google Analytics if needed). No need to add a web/Android/iOS app for **backend-only** FCM; the backend only needs the service account to send messages.

---

## 2. Get the service account JSON file

1. In Firebase Console, open your project.
2. Click the **gear icon** next to “Project Overview” → **Project settings**.
3. Open the **Service accounts** tab.
4. You’ll see “Firebase Admin SDK”. Click **Generate new private key** (or “Generate key” in the dialog). Confirm.
5. A JSON file will download (e.g. `your-project-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`).
   - **Keep this file secret.** Do not commit it to git or expose it publicly.
   - The file contains:
     - `project_id`: your Firebase project ID
     - `private_key_id`, `private_key`: used to get OAuth2 access tokens
     - `client_email`: service account email

---

## 3. Configure the backend

**Option A – Environment variable (recommended)**

1. Put the JSON file somewhere safe on the server (e.g. `/etc/tikuncrm/firebase-service-account.json` or a folder under your app).
2. Set **one** of these in your environment (or in `.env`):

   ```bash
   # Path to the downloaded JSON file (absolute path recommended)
   FCM_SERVICE_ACCOUNT_PATH=/path/to/your-project-firebase-adminsdk-xxxxx.json
   ```

   **Or** use the standard Google env var:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-project-firebase-adminsdk-xxxxx.json
   ```

**Option B – .env file**

In `backend/.env` add:

```env
# Firebase Cloud Messaging (FCM) HTTP V1
FCM_SERVICE_ACCOUNT_PATH=/full/path/to/your-project-firebase-adminsdk-xxxxx.json
# Optional: only if project_id is not in the JSON
# FCM_PROJECT_ID=your-firebase-project-id
```

The backend reads `project_id` from the JSON; you only need `FCM_PROJECT_ID` if you use a different mechanism that doesn’t provide it.

---

## 4. Run database migration

Create the `fcm_tokens` table:

```bash
cd backend
alembic upgrade head
```

---

## 5. Verify

1. Start the backend.
2. As a logged-in user, register an FCM token (see API below) or use your frontend with Firebase SDK.
3. Use **Settings → Notifications → Send Test Notification**. If FCM is configured and the token is valid, the test should be delivered via FCM.

---

## 6. API endpoints for FCM

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/push/fcm/register` | Register an FCM token for the current user. Body: `{"token": "<fcm_token>", "device_name": "optional"}`. |
| `POST` | `/api/v1/push/fcm/unregister` | Remove an FCM token. Body: `{"token": "<fcm_token>"}`. |
| `GET`  | `/api/v1/push/subscriptions` | List all devices (Web Push + FCM); `provider` is `"fcm"` or `"web_push"`. |
| `POST` | `/api/v1/push/test` | Send a test notification to the current user (FCM + Web Push). |

---

## 7. Security

- **Do not** commit the service account JSON to version control. Add it to `.gitignore` (e.g. `*-firebase-adminsdk-*.json` or the path you use).
- On the server, restrict file permissions (e.g. `chmod 600` for the JSON file).
- Prefer `FCM_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` in the server environment over putting paths in `.env` if `.env` is in the repo.

---

## 8. Frontend (optional)

To use FCM from the web app:

1. In Firebase Console, add a **Web app** to the same project and copy the `firebaseConfig` object.
2. Install the Firebase JS SDK and use **Firebase Cloud Messaging** (`getToken()`, `onMessage()`).
3. Send the FCM token to your backend with `POST /api/v1/push/fcm/register`.

The backend will then send push notifications to that token via the FCM HTTP V1 API.
