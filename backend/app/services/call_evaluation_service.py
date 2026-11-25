"""
AI call evaluation — scores a transcript against the manager-editable rubric.

Design rules:
  * The rubric (criteria, weights, descriptions, guidance) is DATA, edited in
    Settings. Nothing about what is judged is hard-coded here.
  * The output SHAPE and the "only cite the transcript" guardrail ARE fixed here,
    so editing the rubric can never break the format or the grounding rule.
  * The LLM returns per-category scores; the weighted overall score is computed
    in code so it is reproducible and auditable.
  * Every quoted piece of evidence is checked against the transcript. Quotes that
    do not appear in the transcript are discarded, and observations whose quotes
    were all fabricated are dropped.
  * The AI's reading of what happened on the call (ai_call_outcome) describes the
    conversation only. Real business outcomes come from CRM tables, elsewhere.
"""
import json
import logging
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.core.config import settings

logger = logging.getLogger(__name__)

# Bump when the fixed prompt/guardrails below change, so evaluations made with
# different instructions can be told apart.
PROMPT_VERSION = "6"

MAX_CRITERIA = 12
MAX_NAME_LEN = 100
MAX_DESC_LEN = 1000
MAX_GUIDANCE_LEN = 4000

AI_CALL_OUTCOMES = (
    "appointment_booked",
    "follow_up_required",
    "no_appointment",
    "not_a_sales_conversation",
)


# Fixed list so objections can be counted across calls on the dashboard.
OBJECTION_CATEGORIES = {
    "price_or_payment": "Price or monthly payment",
    "trade_in_value": "Trade-in value",
    "credit_or_financing": "Credit or financing",
    "timing_or_too_busy": "Timing / too busy to visit",
    "needs_to_consult_someone": "Needs to talk to spouse or family",
    "still_shopping_around": "Still shopping around",
    "vehicle_availability_or_fit": "Vehicle availability or fit",
    "distance_or_location": "Distance or location",
    "not_ready_to_buy": "Not ready to buy yet",
    "wants_info_first": "Wants numbers or information first",
    "other": "Other",
}

HIDDEN_OBJECTION_CONFIDENCE = ("low", "medium", "high")


class RubricValidationError(ValueError):
    """Rubric is not usable; message is safe to show to the manager."""


class EvaluationError(Exception):
    """Raised with a short, non-sensitive message safe to store and show."""


# ---------------------------------------------------------------- rubric ----

def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug[:60] or "criterion"


def validate_rubric_criteria(criteria: Any) -> List[Dict[str, Any]]:
    """
    Validate and normalise criteria coming from the rubric editor.
    Weights are percentages and must total 100.
    """
    if not isinstance(criteria, list) or not criteria:
        raise RubricValidationError("Add at least one criterion.")
    if len(criteria) > MAX_CRITERIA:
        raise RubricValidationError(f"Use at most {MAX_CRITERIA} criteria.")

    out: List[Dict[str, Any]] = []
    seen_keys: set = set()
    total = 0.0
    for i, raw in enumerate(criteria, start=1):
        if not isinstance(raw, dict):
            raise RubricValidationError(f"Criterion {i} is not valid.")
        name = str(raw.get("name") or "").strip()
        if not name:
            raise RubricValidationError(f"Criterion {i} needs a name.")
        if len(name) > MAX_NAME_LEN:
            raise RubricValidationError(f"'{name[:30]}…' name is too long (max {MAX_NAME_LEN} characters).")
        try:
            weight = float(raw.get("weight"))
        except (TypeError, ValueError):
            raise RubricValidationError(f"'{name}' needs a numeric weight.") from None
        if weight <= 0 or weight > 100:
            raise RubricValidationError(f"'{name}' weight must be between 1 and 100.")

        good = str(raw.get("what_good_looks_like") or "").strip()
        bad = str(raw.get("what_bad_looks_like") or "").strip()
        if len(good) > MAX_DESC_LEN or len(bad) > MAX_DESC_LEN:
            raise RubricValidationError(f"'{name}' description is too long (max {MAX_DESC_LEN} characters).")

        # Keep an existing key stable across edits so trends line up between versions
        key = str(raw.get("key") or "").strip() or _slugify(name)
        key = _slugify(key)
        base, n = key, 2
        while key in seen_keys:
            key = f"{base}_{n}"
            n += 1
        seen_keys.add(key)

        total += weight
        out.append(
            {
                "key": key,
                "name": name,
                "weight": round(weight, 2),
                "what_good_looks_like": good,
                "what_bad_looks_like": bad,
            }
        )

    if abs(total - 100.0) > 0.01:
        raise RubricValidationError(f"Weights must add up to 100 (currently {total:g}).")
    return out


def validate_guidance(guidance: Any) -> Optional[str]:
    text = str(guidance or "").strip()
    if len(text) > MAX_GUIDANCE_LEN:
        raise RubricValidationError(f"Overall guidance is too long (max {MAX_GUIDANCE_LEN} characters).")
    return text or None


# ---------------------------------------------------- LLM output schema ----

class Evidence(BaseModel):
    quote: str = Field(min_length=1, max_length=600)
    timestamp_seconds: Optional[float] = None


class CategoryResult(BaseModel):
    key: str
    not_applicable: bool = False
    score: Optional[int] = Field(default=None, ge=0, le=100)
    rationale: str = Field(default="", max_length=1500)
    evidence: List[Evidence] = Field(default_factory=list)


class Observation(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    evidence: List[Evidence] = Field(default_factory=list)


class Improvement(Observation):
    # Rubric criterion this is about, so recurring strengths and problems can be counted
    criterion: Optional[str] = Field(default=None, max_length=80)


class Objection(BaseModel):
    objection: str = Field(min_length=1, max_length=500)
    category: str = "other"
    how_rep_responded: str = Field(default="", max_length=1000)
    resolved: bool = False
    evidence: List[Evidence] = Field(default_factory=list)


class HiddenObjection(BaseModel):
    """The AI's guess at the real concern the customer did not say out loud."""

    guess: str = Field(min_length=1, max_length=500)
    category: str = "other"
    confidence: Literal["low", "medium", "high"] = "low"
    how_to_uncover: str = Field(default="", max_length=600)
    evidence: List[Evidence] = Field(default_factory=list)


class EvaluationOutput(BaseModel):
    summary: str = Field(min_length=1, max_length=2000)
    category_scores: List[CategoryResult]
    strengths: List[Improvement] = Field(default_factory=list)
    improvements: List[Improvement] = Field(default_factory=list)
    missed_appointment_opportunities: List[Observation] = Field(default_factory=list)
    customer_objections: List[Objection] = Field(default_factory=list)
    coaching_suggestions: List[Observation] = Field(default_factory=list)
    hidden_objection: Optional[HiddenObjection] = None
    call_outcome: Literal[
        "appointment_booked", "follow_up_required", "no_appointment", "not_a_sales_conversation"
    ]

    @model_validator(mode="after")
    def _guess_required_on_sales_calls(self):
        # Managers asked for a guess on every sales call, even a low-confidence one
        if self.call_outcome != "not_a_sales_conversation" and self.hidden_objection is None:
            raise ValueError("hidden_objection is required for a sales conversation")
        return self


# ------------------------------------------------------------- prompting ----

_SYSTEM_RULES = """You are a sales-call coach for a car dealership. You review one phone call between a dealership representative (REP) and a customer (CUSTOMER) and score the REP against the dealership's rubric.

Hard rules:
1. Use ONLY what is in the transcript. Never invent events, tone, or words. If the transcript does not show something, do not claim it happened.
2. Do not criticise the rep for something the call gave no opportunity to do. If a rubric criterion had no opportunity to apply (for example, the customer raised no objections), set "not_applicable": true and "score": null for it.
3. Every piece of evidence must be a short, EXACT, word-for-word quote copied from a single transcript line, with that line's start time in seconds. Do not paraphrase inside quotes. If a point is about something that did NOT happen (e.g. the rep never asked for an appointment), give an empty evidence list rather than a made-up quote.
4. Judge the quality of the rep's conversation, not the result. A customer may decline despite an excellent call, and may book despite a poor one. "call_outcome" records only what was agreed during this conversation.
5. Be specific and practical. Coaching suggestions should say what to say or do differently next time, in one short sentence each.
6. Do not include phone numbers, addresses, email addresses or payment details in your output, even if they appear in the transcript.
7. Transcripts come from automatic speech recognition and may contain mis-heard words. Do not penalise the rep for obvious transcription errors.
8. Keep it SHORT. The team reads this in about 15 seconds. Write every "text", "objection", "how_rep_responded" and "rationale" as one plain sentence of under 20 words. Put the most important item first in every list, and give at most 3 items per list.
9. HIDDEN OBJECTION. Customers often give a polite reason that is not the real one ("I'm busy this week" when the real worry is getting approved for credit). For every sales conversation, give your best guess at the real concern the customer did not say out loud, even when your confidence is low. Base it on clues in the transcript: hesitations, questions they asked, topics they avoided or changed. Quote those clues as evidence. If the stated objection looks like the real one, say so. This is a guess for coaching: it never affects any score, and must not be written as fact. Give "how_to_uncover": one question the rep could have asked to bring it out.

Scoring scale for each criterion (0-100): 90-100 excellent, 70-89 good, 50-69 mixed, 25-49 weak, 0-24 not done or done badly when there was a clear opportunity.

Return a single JSON object with exactly these fields:
{
  "summary": "1-2 short sentences: what the call was about and how it ended",
  "category_scores": [
    {"key": "<criterion key>", "not_applicable": false, "score": 0-100 or null, "rationale": "why, in one short sentence", "evidence": [{"quote": "exact words", "timestamp_seconds": 12.5}]}
  ],
  "strengths": [{"text": "...", "criterion": "<the rubric criterion key this is about>", "evidence": [...]}],
  "improvements": [{"text": "...", "criterion": "<the rubric criterion key this is about>", "evidence": [...]}],
  "missed_appointment_opportunities": [{"text": "moment where the rep could have asked for a visit and did not", "evidence": [...]}],
  "customer_objections": [{"objection": "...", "category": "<one of the objection categories below>", "how_rep_responded": "...", "resolved": true/false, "evidence": [...]}],
  "coaching_suggestions": [{"text": "...", "evidence": [...]}],
  "hidden_objection": {"guess": "the real, unstated concern", "category": "<one of the objection categories below>", "confidence": "low" | "medium" | "high", "how_to_uncover": "question the rep could ask", "evidence": [...]} or null ONLY when call_outcome is "not_a_sales_conversation",
  "call_outcome": "appointment_booked" | "follow_up_required" | "no_appointment" | "not_a_sales_conversation"
}
"category_scores" must contain exactly one entry for every criterion key in the rubric, and no others. Lists may be empty when there is nothing supported by the transcript to report.
Objection categories (use the key): """ + ", ".join(f"{k} ({v})" for k, v in OBJECTION_CATEGORIES.items()) + "."


def format_timestamp(seconds: float) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def format_transcript_for_prompt(transcript: List[Dict[str, Any]]) -> str:
    lines = []
    for u in transcript:
        speaker = str(u.get("speaker") or "unknown").upper()
        start = float(u.get("start") or 0.0)
        lines.append(f"[{start:.1f}s] {speaker}: {u.get('text', '')}")
    return "\n".join(lines)


def build_messages(
    transcript: List[Dict[str, Any]],
    criteria: List[Dict[str, Any]],
    guidance: Optional[str],
    direction: Optional[str],
) -> List[Dict[str, str]]:
    rubric_lines = []
    for c in criteria:
        block = f'- key: "{c["key"]}"\n  name: {c["name"]}\n  weight: {c["weight"]:g}%'
        if c.get("what_good_looks_like"):
            block += f"\n  what good looks like: {c['what_good_looks_like']}"
        if c.get("what_bad_looks_like"):
            block += f"\n  what bad looks like: {c['what_bad_looks_like']}"
        rubric_lines.append(block)

    user = "RUBRIC (written by the dealership's sales manager):\n" + "\n".join(rubric_lines)
    if guidance:
        user += f"\n\nOVERALL GUIDANCE FROM THE SALES MANAGER (applies to every call):\n{guidance}"
    if direction:
        user += f"\n\nCALL DIRECTION: {direction} ({'the rep called the customer' if direction == 'outbound' else 'the customer called the dealership'})"
    user += "\n\nTRANSCRIPT (each line starts with its start time in seconds):\n" + format_transcript_for_prompt(transcript)

    return [
        {"role": "system", "content": _SYSTEM_RULES},
        {"role": "user", "content": user},
    ]


# -------------------------------------------------------------- grounding ----

def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", "", text.lower())).strip()


def locate_quote(quote: str, transcript: List[Dict[str, Any]]) -> Optional[int]:
    """Index of the transcript line containing this quote (ignoring case/punctuation), else None."""
    q = _normalise(quote)
    if len(q) < 3:
        return None
    for i, u in enumerate(transcript):
        if q in _normalise(u.get("text") or ""):
            return i
    # Quote may run across two consecutive lines from the same speaker
    for i in range(len(transcript) - 1):
        a, b = transcript[i], transcript[i + 1]
        if a.get("speaker") == b.get("speaker"):
            if q in _normalise(f"{a.get('text') or ''} {b.get('text') or ''}"):
                return i
    return None


def _ground_evidence(evidence: List[Evidence], transcript: List[Dict[str, Any]], stats: Dict[str, int]) -> List[Dict[str, Any]]:
    grounded = []
    for ev in evidence:
        stats["quotes_total"] += 1
        idx = locate_quote(ev.quote, transcript)
        if idx is None:
            continue
        stats["quotes_verified"] += 1
        line = transcript[idx]
        grounded.append(
            {
                "quote": ev.quote.strip(),
                # Timestamp always taken from the transcript, never from the model
                "timestamp_seconds": line.get("start"),
                "speaker": line.get("speaker"),
            }
        )
    return grounded


def _ground_items(items: List[Any], transcript: List[Dict[str, Any]], stats: Dict[str, int]) -> List[Dict[str, Any]]:
    """Ground each item's evidence; drop items whose quotes were ALL unverifiable."""
    out = []
    for item in items:
        data = item.model_dump()
        if "category" in data and data["category"] not in OBJECTION_CATEGORIES:
            data["category"] = "other"
        offered = len(item.evidence)
        data["evidence"] = _ground_evidence(item.evidence, transcript, stats)
        if offered > 0 and not data["evidence"]:
            stats["observations_dropped"] += 1
            continue
        out.append(data)
    return out


def _with_known_criterion(items: List[Dict[str, Any]], keys: List[str]) -> List[Dict[str, Any]]:
    """Keep an improvement's criterion only if it is a key of the rubric used."""
    for item in items:
        if item.get("criterion") not in keys:
            item["criterion"] = None
    return items


def _ground_hidden_objection(
    hidden: Optional["HiddenObjection"], transcript: List[Dict[str, Any]], stats: Dict[str, int]
) -> Optional[Dict[str, Any]]:
    """
    Unlike other items, a guess is kept even when none of its clues can be found
    in the transcript (managers want a guess every time), but it is then marked
    as unsupported and its confidence is capped at "low".
    """
    if hidden is None:
        return None
    data = hidden.model_dump()
    if data["category"] not in OBJECTION_CATEGORIES:
        data["category"] = "other"
    data["evidence"] = _ground_evidence(hidden.evidence, transcript, stats)
    data["supported"] = bool(data["evidence"])
    if not data["supported"]:
        data["confidence"] = "low"
    data["guess"] = data["guess"].strip()
    data["how_to_uncover"] = data["how_to_uncover"].strip()
    return data


# ---------------------------------------------------------------- scoring ----

def compute_overall_score(category_scores: List[Dict[str, Any]]) -> Optional[float]:
    """
    Weighted average over applicable criteria, 0-100. Criteria marked not
    applicable are excluded and the remaining weights are re-normalised.
    Returns None when nothing was applicable.
    """
    total_weight = 0.0
    weighted = 0.0
    for c in category_scores:
        if c.get("not_applicable") or c.get("score") is None:
            continue
        w = float(c.get("weight") or 0)
        total_weight += w
        weighted += w * float(c["score"])
    if total_weight <= 0:
        return None
    return round(weighted / total_weight, 1)


def parse_and_ground(
    raw_text: str,
    transcript: List[Dict[str, Any]],
    criteria: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Validate raw LLM JSON against the schema and the rubric, verify evidence
    against the transcript, and compute the overall score.
    Raises ValueError / ValidationError when the output is not acceptable.
    """
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Response was not valid JSON: {e.msg}") from None
    parsed = EvaluationOutput.model_validate(payload)

    by_key = {c.key: c for c in parsed.category_scores}
    expected = [c["key"] for c in criteria]
    missing = [k for k in expected if k not in by_key]
    extra = [k for k in by_key if k not in expected]
    if missing or extra or len(parsed.category_scores) != len(expected):
        raise ValueError(
            f"category_scores must have exactly one entry per rubric key. Missing: {missing}. Unexpected: {extra}."
        )

    stats = {"quotes_total": 0, "quotes_verified": 0, "observations_dropped": 0}

    category_scores: List[Dict[str, Any]] = []
    for c in criteria:
        r = by_key[c["key"]]
        not_applicable = bool(r.not_applicable or r.score is None)
        category_scores.append(
            {
                "key": c["key"],
                "name": c["name"],
                "weight": c["weight"],
                "not_applicable": not_applicable,
                "score": None if not_applicable else r.score,
                "rationale": r.rationale.strip(),
                "evidence": _ground_evidence(r.evidence, transcript, stats),
            }
        )

    result = {
        "summary": parsed.summary.strip(),
        "strengths": _with_known_criterion(_ground_items(parsed.strengths, transcript, stats), expected),
        "improvements": _with_known_criterion(_ground_items(parsed.improvements, transcript, stats), expected),
        "missed_appointment_opportunities": _ground_items(parsed.missed_appointment_opportunities, transcript, stats),
        "customer_objections": _ground_items(parsed.customer_objections, transcript, stats),
        "coaching_suggestions": _ground_items(parsed.coaching_suggestions, transcript, stats),
        "hidden_objection": _ground_hidden_objection(parsed.hidden_objection, transcript, stats),
        "grounding": stats,
    }
    return {
        "overall_score": compute_overall_score(category_scores),
        "category_scores": category_scores,
        "result": result,
        "ai_call_outcome": parsed.call_outcome,
    }


# ------------------------------------------------------------------- LLM ----

async def _call_llm(messages: List[Dict[str, str]]) -> str:
    """Single LLM call returning raw JSON text. Isolated so tests can replace it."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=120.0)
    response = await client.chat.completions.create(
        model=settings.call_review_model,
        temperature=0,
        seed=7,
        response_format={"type": "json_object"},
        messages=messages,
    )
    return (response.choices[0].message.content or "").strip()


async def evaluate_transcript(
    transcript: List[Dict[str, Any]],
    criteria: List[Dict[str, Any]],
    guidance: Optional[str] = None,
    direction: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Evaluate a transcript against rubric criteria.

    Returns {overall_score, category_scores, result, ai_call_outcome, llm_model, prompt_version}.
    Invalid model output is retried once with the validation error fed back.
    """
    if not settings.openai_api_key:
        raise EvaluationError("AI evaluation is not configured (OPENAI_API_KEY is missing)")
    if not transcript:
        raise EvaluationError("Transcript is empty")

    messages = build_messages(transcript, criteria, guidance, direction)
    last_problem = ""
    for attempt in range(2):
        try:
            raw = await _call_llm(messages)
        except Exception as e:  # network / provider errors
            raise EvaluationError(f"AI provider request failed ({type(e).__name__})") from None
        try:
            evaluated = parse_and_ground(raw, transcript, criteria)
        except (ValueError, ValidationError) as e:
            last_problem = _short_validation_message(e)
            logger.warning("Call evaluation output rejected (attempt %d): %s", attempt + 1, last_problem)
            messages = messages + [
                {"role": "assistant", "content": raw[:6000]},
                {
                    "role": "user",
                    "content": f"That response was rejected: {last_problem}. Return the corrected JSON object only.",
                },
            ]
            continue
        evaluated["llm_model"] = settings.call_review_model
        evaluated["prompt_version"] = PROMPT_VERSION
        return evaluated

    raise EvaluationError(f"AI returned an invalid evaluation twice ({last_problem[:200]})")


def _short_validation_message(e: Exception) -> str:
    """Describe what was wrong with the output without echoing transcript content."""
    if isinstance(e, ValidationError):
        parts = [f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors()[:5]]
        return "; ".join(parts)
    return str(e)[:300]

