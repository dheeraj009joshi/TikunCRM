"""
Pydantic Schemas for the Eligibility (Trust) Score engine.
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

InputType = Literal["boolean", "number", "select"]
ValueSource = Literal["manual", "auto"]
EntityType = Literal["lead", "customer", "guest"]


# ============== Criteria ==============

class CriterionBase(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    category: str = Field("General", max_length=100)
    weight: Decimal = Field(0, ge=0)
    input_type: InputType = "boolean"
    value_source: ValueSource = "manual"
    auto_field: Optional[str] = Field(None, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)
    display_order: int = 0
    is_active: bool = True


class CriterionCreate(CriterionBase):
    dealership_id: Optional[UUID] = None
    key: Optional[str] = Field(None, max_length=100)


class CriterionUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    weight: Optional[Decimal] = Field(None, ge=0)
    input_type: Optional[InputType] = None
    value_source: Optional[ValueSource] = None
    auto_field: Optional[str] = Field(None, max_length=100)
    config: Optional[dict[str, Any]] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class CriterionReorder(BaseModel):
    ordered_ids: List[UUID]


class CriterionResponse(BaseModel):
    id: UUID
    dealership_id: Optional[UUID] = None
    key: str
    label: str
    description: Optional[str] = None
    category: str
    weight: Decimal
    input_type: str
    value_source: str
    auto_field: Optional[str] = None
    config: dict[str, Any]
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============== Assessment ==============

class AssessmentItemState(BaseModel):
    """Per-criterion state merged with its definition, for UI rendering."""
    criterion_id: UUID
    label: str
    description: Optional[str] = None
    category: str
    input_type: str
    value_source: str
    auto_field: Optional[str] = None
    config: dict[str, Any]
    weight: Decimal
    display_order: int
    # Current evaluated state
    is_met: bool
    value: Optional[dict[str, Any]] = None
    is_override: bool
    points: Decimal
    # The auto-resolved value (so UI can show "from data: 2500")
    auto_value: Optional[Any] = None


class AssessmentResponse(BaseModel):
    entity_type: str
    entity_id: UUID
    dealership_id: Optional[UUID] = None
    total_score: Decimal
    raw_points: Decimal
    max_points: Decimal
    items: List[AssessmentItemState]
    updated_at: Optional[datetime] = None


class AssessmentItemUpdate(BaseModel):
    """Toggle / set one criterion's state."""
    is_met: Optional[bool] = None
    value: Optional[dict[str, Any]] = None
    # When omitted, the toggle is treated as a manual override.
    is_override: bool = True
