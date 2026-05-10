from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import os

# Create profile folder if not exists
PROFILE_PATH = os.path.abspath("chrome_profile")

options = Options()
options.add_argument(f"--user-data-dir={PROFILE_PATH}")

# Optional but useful
options.add_argument("--profile-directory=Default")
options.add_argument("--start-maximized")

driver = webdriver.Chrome(options=options)

driver.get("https://web.whatsapp.com")

input("Scan QR (only first time), then press ENTER...")