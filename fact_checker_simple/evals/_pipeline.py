"""Shared helper: run the real pipeline on a single claim and return the
prediction plus the evidence context (used by every eval layer)."""
from models import EvidenceItem
from fact_checker import (
    search_claim, verify_claims, _clean_evidence, assess_evidence_sufficiency,
)
from config import ABSTENTION_THRESHOLD


def analyze_claim(claim: str, compute_sufficiency: bool = True,
                  abstain_threshold: float | None = None) -> dict:
    """Search + verify one claim.

    Returns the final verdict, plus the *raw* verdict and the evidence-sufficiency
    score so a caller can study calibrated abstention. When sufficiency is below
    the threshold, a committed SUPPORTS/REFUTES is overridden to NOT_ENOUGH_INFO.
    """
    ev_text = search_claim(claim)
    evidence = [EvidenceItem(claim_index=0, query=claim, raw_results=ev_text)]
    v = verify_claims([claim], evidence)[0]
    raw_verdict = v.verdict

    sufficiency = assess_evidence_sufficiency(claim, ev_text) if compute_sufficiency else None

    thr = ABSTENTION_THRESHOLD if abstain_threshold is None else abstain_threshold
    final = raw_verdict
    if (thr and thr > 0.0 and sufficiency is not None
            and sufficiency < thr and raw_verdict in ("SUPPORTS", "REFUTES")):
        final = "NOT_ENOUGH_INFO"

    return {
        "claim": claim,
        "verdict": final,
        "raw_verdict": raw_verdict,
        "sufficiency": sufficiency,
        "confidence": v.confidence,
        "justification": v.justification,
        "context": _clean_evidence(ev_text)[:4000],
    }
