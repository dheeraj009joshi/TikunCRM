"""
Auto WhatsApp Selenium Driver Service

Handles browser automation for WhatsApp Web:
- Chrome profile management per dealership
- QR code capture for initial setup
- Login status verification
- Message sending
"""
import base64
import logging
import os
import random
import re
import time
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    WebDriverException,
    StaleElementReferenceException,
)

# Try to use webdriver-manager for automatic driver management
try:
    from webdriver_manager.chrome import ChromeDriverManager
    USE_WEBDRIVER_MANAGER = True
except ImportError:
    USE_WEBDRIVER_MANAGER = False

logger = logging.getLogger(__name__)

# Base directory for Chrome profiles (relative to backend/)
BASE_PROFILES_DIR = Path(__file__).resolve().parents[2] / "auto_whatsapp" / "profiles"

# WhatsApp Web XPath selectors
SELECTORS = {
    "qr_code": '//canvas[@aria-label="Scan this QR code to link a device!"]',
    "qr_code_alt": '//div[@data-ref]//canvas',
    "pane_side": "pane-side",  # ID - appears when logged in
    "search_box": '//div[@contenteditable="true"][@data-tab="3"]',
    "message_input": '//div[@contenteditable="true"][@data-tab="10"]',
    "send_button": '//button[@aria-label="Send"]',
    "chat_list": '//div[@data-testid="cell-frame-container"]',
    "invalid_number_popup": '//div[contains(text(), "Phone number shared via url is invalid")]',
    "ok_button": '//div[@role="button"][contains(text(), "OK")]',
}


class AutoWhatsAppDriver:
    """
    Selenium-based driver for WhatsApp Web automation.
    Each instance manages one browser session for a dealership.
    """

    def __init__(self, dealership_slug: str, headless: bool = True):
        """
        Initialize driver for a specific dealership.
        
        Args:
            dealership_slug: URL-safe dealership identifier for profile directory
            headless: Run in headless mode (no visible browser window). Default True for server use.
        """
        self.dealership_slug = dealership_slug
        self.headless = headless
        self.profile_path = BASE_PROFILES_DIR / dealership_slug
        self.driver: Optional[webdriver.Chrome] = None
        self._is_initialized = False

    def _ensure_profile_dir(self) -> Path:
        """Create profile directory if it doesn't exist"""
        self.profile_path.mkdir(parents=True, exist_ok=True)
        return self.profile_path

    def _get_chrome_options(self) -> Options:
        """Configure Chrome options for WhatsApp Web automation"""
        options = Options()
        
        # Set profile directory to persist login
        profile_dir = self._ensure_profile_dir()
        options.add_argument(f"--user-data-dir={profile_dir}")
        options.add_argument("--profile-directory=Default")
        
        # Headless mode
        if self.headless:
            options.add_argument("--headless=new")
            options.add_argument("--window-size=1920,1080")
        
        # Stability and anti-detection flags
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-infobars")
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)
        
        # User agent to appear more human-like
        options.add_argument(
            "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        
        return options

    def start(self, timeout: int = 30) -> bool:
        """
        Start the browser and navigate to WhatsApp Web.
        
        Args:
            timeout: Seconds to wait for page to load
            
        Returns:
            True if started successfully, False otherwise
        """
        try:
            if self.driver:
                self.stop()
            
            logger.info(f"Starting WhatsApp driver for dealership: {self.dealership_slug} (headless={self.headless})")
            logger.info(f"Profile path: {self.profile_path}")
            options = self._get_chrome_options()
            
            try:
                # Try using webdriver-manager first (auto-downloads correct driver)
                if USE_WEBDRIVER_MANAGER:
                    try:
                        service = Service(ChromeDriverManager().install())
                        self.driver = webdriver.Chrome(service=service, options=options)
                        logger.info("Using webdriver-manager for ChromeDriver")
                    except Exception as wdm_error:
                        logger.warning(f"webdriver-manager failed: {wdm_error}, falling back to default")
                        # Fallback to Selenium's built-in manager (Selenium 4.6+)
                        self.driver = webdriver.Chrome(options=options)
                else:
                    # Use Selenium's built-in Selenium Manager (4.6+)
                    self.driver = webdriver.Chrome(options=options)
            except WebDriverException as e:
                error_msg = str(e).lower()
                if "chromedriver" in error_msg or "chrome not reachable" in error_msg:
                    logger.error(
                        f"Chrome/ChromeDriver not found or not compatible. "
                        f"Please ensure Chrome browser and ChromeDriver are installed. "
                        f"Try: pip install webdriver-manager. Error: {e}"
                    )
                elif "user data directory" in error_msg or "profile" in error_msg:
                    logger.error(f"Profile directory issue: {e}. Path: {self.profile_path}")
                else:
                    logger.error(f"WebDriver error: {e}")
                return False
            
            # Navigate to WhatsApp Web
            self.driver.get("https://web.whatsapp.com")
            self._is_initialized = True
            
            # Wait for page to load (either QR code or main interface)
            time.sleep(3)
            
            logger.info(f"WhatsApp Web opened for {self.dealership_slug}")
            return True
            
        except WebDriverException as e:
            logger.error(f"Failed to start Chrome driver: {e}")
            self._is_initialized = False
            return False
        except Exception as e:
            logger.exception(f"Unexpected error starting driver: {e}")
            self._is_initialized = False
            return False

    def stop(self):
        """Stop the browser and cleanup"""
        if self.driver:
            try:
                self.driver.quit()
            except Exception as e:
                logger.warning(f"Error quitting driver: {e}")
            finally:
                self.driver = None
                self._is_initialized = False
                logger.info(f"WhatsApp driver stopped for {self.dealership_slug}")

    def is_logged_in(self, timeout: int = 5) -> bool:
        """
        Check if WhatsApp Web is logged in (QR already scanned).
        
        Args:
            timeout: Seconds to wait for login indicator
            
        Returns:
            True if logged in, False otherwise
        """
        if not self.driver:
            return False
        
        try:
            wait = WebDriverWait(self.driver, timeout)
            wait.until(EC.presence_of_element_located((By.ID, SELECTORS["pane_side"])))
            return True
        except TimeoutException:
            return False
        except Exception as e:
            logger.warning(f"Error checking login status: {e}")
            return False

    def get_qr_code_base64(self, timeout: int = 15) -> Optional[str]:
        """
        Capture QR code as base64-encoded PNG image.
        
        Args:
            timeout: Seconds to wait for QR code to appear
            
        Returns:
            Base64-encoded PNG string, or None if not found
        """
        if not self.driver:
            logger.error("Driver not initialized")
            return None
        
        try:
            wait = WebDriverWait(self.driver, timeout)
            
            # Try primary selector first
            try:
                qr_canvas = wait.until(
                    EC.presence_of_element_located((By.XPATH, SELECTORS["qr_code"]))
                )
            except TimeoutException:
                # Try alternative selector
                qr_canvas = wait.until(
                    EC.presence_of_element_located((By.XPATH, SELECTORS["qr_code_alt"]))
                )
            
            # Take screenshot of the QR canvas
            qr_screenshot = qr_canvas.screenshot_as_base64
            logger.info(f"QR code captured for {self.dealership_slug}")
            return qr_screenshot
            
        except TimeoutException:
            # Check if already logged in
            if self.is_logged_in(timeout=2):
                logger.info(f"Already logged in, no QR code needed for {self.dealership_slug}")
                return None
            logger.warning(f"QR code not found within {timeout}s for {self.dealership_slug}")
            return None
        except Exception as e:
            logger.exception(f"Error capturing QR code: {e}")
            return None

    def wait_for_login(self, timeout: int = 120, poll_interval: int = 2) -> bool:
        """
        Wait for user to scan QR code and login.
        
        Args:
            timeout: Total seconds to wait
            poll_interval: Seconds between checks
            
        Returns:
            True if login successful, False if timeout
        """
        if not self.driver:
            return False
        
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.is_logged_in(timeout=2):
                logger.info(f"Login successful for {self.dealership_slug}")
                return True
            time.sleep(poll_interval)
        
        logger.warning(f"Login timeout after {timeout}s for {self.dealership_slug}")
        return False

    def send_message(
        self,
        phone_number: str,
        message: str,
        timeout: int = 30
    ) -> Tuple[bool, Optional[str]]:
        """
        Send a WhatsApp message to a phone number.
        
        Args:
            phone_number: Phone number with country code (e.g., +919876543210)
            message: Message text to send
            timeout: Seconds to wait for each step
            
        Returns:
            Tuple of (success: bool, error_message: Optional[str])
        """
        if not self.driver:
            return False, "Driver not initialized"
        
        if not self.is_logged_in():
            return False, "Not logged in to WhatsApp"
        
        try:
            # Clean phone number (remove spaces, dashes, and leading +)
            clean_phone = re.sub(r"[\s\-\+]", "", phone_number)
            if not clean_phone.isdigit():
                return False, f"Invalid phone number format: {phone_number}"
            
            # URL-encode the message
            encoded_message = quote(message)
            
            # Navigate directly to the chat with pre-filled message
            chat_url = f"https://web.whatsapp.com/send?phone={clean_phone}&text={encoded_message}"
            self.driver.get(chat_url)
            
            wait = WebDriverWait(self.driver, timeout)
            
            # Check for invalid number popup
            try:
                invalid_popup = WebDriverWait(self.driver, 5).until(
                    EC.presence_of_element_located((By.XPATH, SELECTORS["invalid_number_popup"]))
                )
                # Click OK to dismiss
                ok_btn = self.driver.find_element(By.XPATH, SELECTORS["ok_button"])
                ok_btn.click()
                time.sleep(1)
                return False, "Phone number not on WhatsApp"
            except TimeoutException:
                pass  # No invalid number popup, continue
            
            # Wait for message input to be ready
            try:
                msg_input = wait.until(
                    EC.presence_of_element_located((By.XPATH, SELECTORS["message_input"]))
                )
            except TimeoutException:
                return False, "Message input not found - chat may not have loaded"
            
            # Small delay to ensure UI is stable
            time.sleep(1)
            
            # Find and click send button
            try:
                send_btn = wait.until(
                    EC.element_to_be_clickable((By.XPATH, SELECTORS["send_button"]))
                )
                send_btn.click()
            except TimeoutException:
                return False, "Send button not clickable"
            
            # Wait a moment for message to be sent
            time.sleep(2)
            
            logger.info(f"Message sent to {phone_number}")
            return True, None
            
        except StaleElementReferenceException:
            return False, "Page element became stale - please retry"
        except TimeoutException as e:
            return False, f"Timeout: {str(e)}"
        except Exception as e:
            logger.exception(f"Error sending message to {phone_number}: {e}")
            return False, str(e)

    def get_profile_path(self) -> str:
        """Get the Chrome profile path for this dealership"""
        return str(self.profile_path)

    def take_screenshot(self) -> Optional[str]:
        """Take a full page screenshot as base64"""
        if not self.driver:
            return None
        try:
            return self.driver.get_screenshot_as_base64()
        except Exception as e:
            logger.warning(f"Failed to take screenshot: {e}")
            return None


class AutoWhatsAppDriverManager:
    """
    Singleton manager for WhatsApp drivers.
    Maintains active driver instances and handles lifecycle.
    """
    _instance: Optional["AutoWhatsAppDriverManager"] = None
    _drivers: dict[str, AutoWhatsAppDriver] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._drivers = {}
        return cls._instance

    def get_driver(self, dealership_slug: str, headless: bool = True) -> AutoWhatsAppDriver:
        """
        Get or create a driver for a dealership.
        
        Args:
            dealership_slug: Dealership identifier
            headless: Run in headless mode (default True for server use)
            
        Returns:
            AutoWhatsAppDriver instance
        """
        if dealership_slug not in self._drivers:
            self._drivers[dealership_slug] = AutoWhatsAppDriver(dealership_slug, headless)
        return self._drivers[dealership_slug]

    def stop_driver(self, dealership_slug: str):
        """Stop and remove a driver for a dealership"""
        if dealership_slug in self._drivers:
            self._drivers[dealership_slug].stop()
            del self._drivers[dealership_slug]

    def stop_all(self):
        """Stop all active drivers"""
        for slug in list(self._drivers.keys()):
            self.stop_driver(slug)

    def get_active_drivers(self) -> list[str]:
        """Get list of dealership slugs with active drivers"""
        return list(self._drivers.keys())


# Global driver manager instance
driver_manager = AutoWhatsAppDriverManager()


def get_random_delay(min_seconds: float = 5.0, max_seconds: float = 10.0) -> float:
    """Get a random delay between min and max seconds for anti-ban measures"""
    return random.uniform(min_seconds, max_seconds)
