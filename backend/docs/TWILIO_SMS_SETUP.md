# Twilio SMS Setup (Including Trial)

TikunCRM can send text (SMS) notifications using **Twilio**. You can use a **free trial account** to test.

## What gets SMS in the app

When SMS is enabled, the app can send text messages for:

- **New lead alerts** – team members get SMS when a new lead is added
- **Appointment confirmations** – lead gets SMS when an appointment is booked
- **Appointment reminders** – lead gets SMS 1 hour before the appointment
- **Follow-up reminders** – assigned user gets SMS 1 hour before a follow-up is due
- **SKATE / assignment alerts** – when configured to use SMS

## Using a Twilio trial account

### 1. Sign up and get credentials

1. Go to [twilio.com](https://www.twilio.com) and create an account (trial is free).
2. In the [Twilio Console](https://console.twilio.com):
   - **Account SID** and **Auth Token** are on the dashboard.
   - Go to **Phone Numbers → Manage → Active numbers**. On trial you get one **trial phone number** (e.g. +1 555 xxx xxxx). Use this as the “from” number.

### 2. Trial limitation: verified numbers only

- On a **trial** account, Twilio only allows sending SMS **to phone numbers you have verified**.
- In Console go to **Phone Numbers → Manage → Verified Caller IDs**.
- Add and verify every phone number that should **receive** SMS (e.g. your team’s phones and any lead phones you want to test).
- Until a number is verified, Twilio will reject sends to it (you may see an error in logs).

### 3. Set environment variables

In your backend `.env`:

```env
# Twilio (trial or paid)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_from_console
TWILIO_PHONE_NUMBER=+15551234567
SMS_NOTIFICATIONS_ENABLED=true
```

- Use the **trial phone number** from the Console as `TWILIO_PHONE_NUMBER` (include country code, e.g. `+1` for US).
- Set `SMS_NOTIFICATIONS_ENABLED=true` so the app actually sends SMS.

### 4. Restart backend

Restart the backend server after changing `.env`. SMS will be sent when the events above occur, but only to **verified** numbers on a trial account.

## Moving off trial (production)

- Upgrade the Twilio account and add a non-trial phone number for sending.
- You no longer need to verify recipient numbers; any valid number can receive SMS (subject to Twilio’s pricing and policies).

## Troubleshooting

- **SMS not sending** – Check `SMS_NOTIFICATIONS_ENABLED=true` and that all three Twilio env vars are set. Check backend logs for Twilio errors.
- **“Permission denied” or “not verified”** – On trial, add and verify the recipient number in **Verified Caller IDs**.
- **Invalid phone number** – Ensure numbers are in E.164 format (e.g. `+1234567890`). The app will try to format them; if it fails, update the stored phone to include country code.
