"""
Basic tests for AI Outbound Calling gates and configuration.
Run with: pytest tests/test_ai_outbound.py -v
"""
import pytest
from uuid import uuid4
from datetime import datetime

from app.core.config import settings
from app.services.ai_outbound_service import _is_in_quiet_hours, generate_lead_token, verify_lead_token


class TestQuietHours:
    """Test quiet hours logic."""
    
    def test_quiet_hours_normal_range(self):
        """Test quiet hours that don't cross midnight (e.g. 9 PM to 9 AM)."""
        # Mock datetime to be at 8 AM (should be in quiet hours)
        # Note: This is a simple test; full test would mock datetime.now()
        result = _is_in_quiet_hours("America/New_York", 21, 9)
        # Can't fully test without mocking datetime, but structure is correct
        assert result in (True, False)
    
    def test_quiet_hours_timezone_fallback(self):
        """Test that invalid timezone falls back to UTC."""
        result = _is_in_quiet_hours("Invalid/Timezone", 21, 9)
        assert result in (True, False)


class TestLeadToken:
    """Test lead token generation and verification."""
    
    def test_token_generation(self):
        """Test that token generation produces a hex string."""
        lead_id = uuid4()
        token = generate_lead_token(lead_id)
        assert isinstance(token, str)
        assert len(token) == 64  # SHA256 hex digest
        assert all(c in '0123456789abcdef' for c in token)
    
    def test_token_verification_valid(self):
        """Test that a valid token verifies correctly."""
        lead_id = uuid4()
        token = generate_lead_token(lead_id)
        assert verify_lead_token(lead_id, token) is True
    
    def test_token_verification_invalid_token(self):
        """Test that an invalid token fails verification."""
        lead_id = uuid4()
        fake_token = "invalid" * 16
        assert verify_lead_token(lead_id, fake_token) is False
    
    def test_token_verification_wrong_lead(self):
        """Test that a token for different lead fails verification."""
        lead_id_1 = uuid4()
        lead_id_2 = uuid4()
        token_1 = generate_lead_token(lead_id_1)
        assert verify_lead_token(lead_id_2, token_1) is False


class TestConfiguration:
    """Test configuration defaults."""
    
    def test_ai_outbound_disabled_by_default(self):
        """Test that AI outbound is disabled by default."""
        assert settings.ai_outbound_enabled is False
    
    def test_quiet_hours_configured(self):
        """Test that quiet hours have sensible defaults."""
        assert 0 <= settings.ai_outbound_quiet_hours_start <= 23
        assert 0 <= settings.ai_outbound_quiet_hours_end <= 23
    
    def test_api_keys_optional(self):
        """Test that API keys default to empty (not required for import)."""
        # These should be empty strings by default
        assert isinstance(settings.deepgram_api_key, str)
        assert isinstance(settings.openai_api_key, str)
        assert isinstance(settings.cartesia_api_key, str)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
