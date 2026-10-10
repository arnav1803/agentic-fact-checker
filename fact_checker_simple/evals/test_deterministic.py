"""
Layer 1 — Deterministic unit tests (pytest).  NO LLM, NO network, instant.

These lock down the pure logic that the pipeline's correctness depends on:
scoring, verdict-label derivation, binary/evidence sanitisation and JSON parsing.

Run:   pytest evals/test_deterministic.py -v
"""
import pytest

from models import VerdictItem
from fact_checker import (
    compute_credibility_score,
    compute_overall_label,
    _looks_binary,
    _clean_evidence,
    _parse_json,
)


def V(verdict, conf=0.9, claim="c"):
    return VerdictItem(claim=claim, verdict=verdict, confidence=conf, justification="")


# ── compute_credibility_score ────────────────────────────────────────────────

def test_score_empty_is_neutral():
    assert compute_credibility_score([]) == 0.5

def test_score_all_supports_is_high():
    assert compute_credibility_score([V("SUPPORTS", 1.0), V("SUPPORTS", 1.0)]) == 1.0

def test_score_all_refutes_is_low():
    assert compute_credibility_score([V("REFUTES", 1.0), V("REFUTES", 1.0)]) == 0.0

def test_score_balanced_is_middle():
    assert compute_credibility_score([V("SUPPORTS", 1.0), V("REFUTES", 1.0)]) == 0.5

def test_score_nei_is_neutral():
    assert compute_credibility_score([V("NOT_ENOUGH_INFO", 0.9)]) == 0.5

def test_score_is_bounded():
    s = compute_credibility_score([V("SUPPORTS", 0.7), V("REFUTES", 0.3)])
    assert 0.0 <= s <= 1.0


# ── compute_overall_label ────────────────────────────────────────────────────

def test_label_empty_is_unverified():
    assert compute_overall_label([], 0.5) == "UNVERIFIED"

def test_label_all_nei_is_unverified():
    # No evidence found either way must never be FALSE
    assert compute_overall_label([V("NOT_ENOUGH_INFO"), V("NOT_ENOUGH_INFO")], 0.5) == "UNVERIFIED"

def test_label_high_score_is_true():
    assert compute_overall_label([V("SUPPORTS", 0.95)], 0.95) == "TRUE"

def test_label_low_score_is_false():
    assert compute_overall_label([V("REFUTES", 0.95)], 0.05) == "FALSE"

def test_label_mid_score_is_mixed():
    vs = [V("SUPPORTS", 0.5), V("REFUTES", 0.4)]
    assert compute_overall_label(vs, 0.45) == "MIXED"


# ── binary / evidence sanitisation ───────────────────────────────────────────

PNG_GARBAGE = "IHDR \xf0 \xf1 sRGB \xbc gAMA IDATx " + "\xbc " * 400

def test_looks_binary_flags_png():
    assert _looks_binary(PNG_GARBAGE) is True

def test_looks_binary_passes_real_text():
    assert _looks_binary("India will run bullet trains at 280 kmph by 2027.") is False

def test_clean_evidence_removes_binary():
    assert _clean_evidence(PNG_GARBAGE) == "[non-text content omitted]"

def test_clean_evidence_keeps_real_text():
    txt = "Spain beat France 2-0 in the semi-final, per Reuters."
    assert "Spain beat France" in _clean_evidence(txt)


# ── JSON parsing robustness ──────────────────────────────────────────────────

def test_parse_json_plain_array():
    assert _parse_json('["a", "b"]') == ["a", "b"]

def test_parse_json_markdown_fenced():
    assert _parse_json('```json\n[{"x": 1}]\n```') == [{"x": 1}]

def test_parse_json_strips_control_chars():
    assert _parse_json('[\x00"ok"\x07]') == ["ok"]

def test_parse_json_raises_on_garbage():
    with pytest.raises((ValueError, Exception)):
        _parse_json("this is not json at all")
