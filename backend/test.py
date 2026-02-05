import firebase_admin
from firebase_admin import credentials, messaging

# 🔹 load service account
cred = credentials.Certificate("firebase-service-account.json")

firebase_admin.initialize_app(cred)

# 🔹 your token
token = "emTBHK_Blcokrf58CjDPMk:APA91bETxh_zFPQsngfMw9VtSfA5WqS05z_NCugF_dqjE5h89AJD8qKo6DHVaoNb_y3gn75nJOVZ2pqeV85xpO_jp18LvuKbp6lMaETQJjMDNFbxLvtkdYk"


message = messaging.Message(
    token=token,

    notification=messaging.Notification(
        title="🔥 TikunCRM Test",
        body="Push notification from Python backend works!"
    ),

    webpush=messaging.WebpushConfig(
        notification=messaging.WebpushNotification(
            icon="https://cdn-icons-png.flaticon.com/512/1827/1827392.png"
        )
    ),

    data={
        "url": "/dashboard"
    }
)

try:
    response = messaging.send(message)
    print("✅ Successfully sent:", response)

except Exception as e:
    print("❌ Error:", e)
