from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import os
import time

PROFILE_PATH = os.path.abspath("chrome_profile")

options = Options()
options.add_argument(f"--user-data-dir={PROFILE_PATH}")
options.add_argument("--profile-directory=Default")

# ✅ Headless mode (new version)
# options.add_argument("--headless=new")
# options.add_argument("--window-size=1920,1080")

# Stability flags
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")

driver = webdriver.Chrome(options=options)

print("Opening WhatsApp...")
driver.get("https://web.whatsapp.com")
# input("Scan QR (only first time), then press ENTER...")
wait = WebDriverWait(driver, 30)


print("Waiting for login...")
wait.until(EC.presence_of_element_located((By.ID, "pane-side")))
print("Logged in ✅")

# print("Opening chat...")
# driver.get("https://web.whatsapp.com/send?phone=917877424770&text=Hola%20test")

# print("Waiting for message box...")
# msg_box = wait.until(
#     EC.presence_of_element_located((By.XPATH, '//div[@contenteditable="true"]'))
# )
# print("Message box ready ✅")

# time.sleep(2)

# print("Clicking box...")
# msg_box.click()

# print("Sending ENTER...")
# from selenium.webdriver.common.by import By
# from selenium.webdriver.support.ui import WebDriverWait
# from selenium.webdriver.support import expected_conditions as EC

# wait = WebDriverWait(driver, 20)

# send_btn = wait.until(
#     EC.element_to_be_clickable((By.XPATH, '//button[@aria-label="Send"]'))
# )

# send_btn.click()



unread_chats = driver.find_elements(
    By.XPATH,
     '//div[@data-testid="cell-frame-container"]//span[@data-testid="icon-unread-count"]'

)   

print(len(unread_chats))
print(unread_chats[0].text)

for i, chat in enumerate(unread_chats):
    try:
        parent = chat.find_element(By.XPATH, './parent::*')
        print(f"Chat {i} found")
    except:
        print(f"Chat {i} failed")
time.sleep(2)
print("Done ✅")
# input("Press ENTER to exit...")