"""
Schemas module initialization
"""
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    TokenPayload,
    RefreshTokenRequest,
    CurrentUser,
)
from app.schemas.user import (
    UserBase,
    UserCreate,
    UserUpdate,
    UserResponse,
    UserBrief,
)
from app.schemas.dealership import (
    DealershipBase,
    DealershipCreate,
    DealershipUpdate,
    DealershipResponse,
    DealershipBrief,
)
from app.schemas.lead import (
    LeadCreate,
    LeadUpdate,
    LeadResponse,
    LeadDetail,
    LeadStageChangeRequest,
    LeadAssignment,
)
from app.schemas.activity import (
    ActivityCreate,
    ActivityResponse,
    ActivityWithUser,
    NoteCreate,
)
from app.schemas.follow_up import (
    FollowUpBase,
    FollowUpCreate,
    FollowUpUpdate,
    FollowUpResponse,
    ScheduleBase,
    ScheduleCreate,
    ScheduleResponse,
)

__all__ = [
    # Auth
    "LoginRequest",
    "TokenResponse",
    "TokenPayload",
    "RefreshTokenRequest",
    "CurrentUser",
    # User
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserBrief",
    # Dealership
    "DealershipBase",
    "DealershipCreate",
    "DealershipUpdate",
    "DealershipResponse",
    "DealershipBrief",
    # Lead
    "LeadCreate",
    "LeadUpdate",
    "LeadResponse",
    "LeadDetail",
    "LeadStageChangeRequest",
    "LeadAssignment",
    # Activity
    "ActivityCreate",
    "ActivityResponse",
    "ActivityWithUser",
    "NoteCreate",
    # Follow-up & Schedule
    "FollowUpBase",
    "FollowUpCreate",
    "FollowUpUpdate",
    "FollowUpResponse",
    "ScheduleBase",
    "ScheduleCreate",
    "ScheduleResponse",
]
