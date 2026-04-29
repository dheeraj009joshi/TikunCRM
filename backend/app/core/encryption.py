"""
Encryption utilities for storing sensitive data like passwords
"""
import base64
import logging

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_encryption_key() -> bytes:
    """
    Derive an encryption key from the application's secret key.
    Uses PBKDF2 to derive a Fernet-compatible key from the secret.
    """
    # Use the app's secret key as the base
    password = settings.secret_key.encode()
    
    # Use a fixed salt derived from the app name (consistent across restarts)
    salt = f"{settings.app_name}_encryption_salt".encode()
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    
    key = base64.urlsafe_b64encode(kdf.derive(password))
    return key


def get_fernet() -> Fernet:
    """Get a Fernet instance for encryption/decryption"""
    return Fernet(_get_encryption_key())


def encrypt_value(value: str) -> str:
    """
    Encrypt a string value and return it as a base64 encoded string.
    
    Args:
        value: The plaintext string to encrypt
        
    Returns:
        Base64 encoded encrypted string
    """
    if not value:
        return ""
    
    fernet = get_fernet()
    encrypted = fernet.encrypt(value.encode())
    return base64.urlsafe_b64encode(encrypted).decode()


def decrypt_value(encrypted_value: str) -> str:
    """
    Decrypt a base64 encoded encrypted string.

    Returns empty string if value is missing, malformed, or cannot be decrypted
    (e.g. row was encrypted with a different SECRET_KEY/JWT_SECRET — typical when
    using a production DB dump locally). Callers should fall back to env/global secrets.
    """
    if not encrypted_value:
        return ""

    try:
        fernet = get_fernet()
        encrypted = base64.urlsafe_b64decode(encrypted_value.encode())
        decrypted = fernet.decrypt(encrypted)
        return decrypted.decode()
    except (InvalidToken, ValueError, TypeError) as e:
        logger.warning(
            "Stored secret could not be decrypted (%s). "
            "If you copied the DB from another environment, align SECRET_KEY/JWT_SECRET "
            "or re-save Twilio credentials in Settings.",
            type(e).__name__,
        )
        return ""
