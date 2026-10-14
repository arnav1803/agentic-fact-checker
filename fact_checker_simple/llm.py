"""
llm.py — Groq chat-model access shared by the fact-checking pipeline and MADAM-RAG.

Every call goes through `invoke`, which retries with backoff when Groq
rate-limits (its free tier allows ~12k tokens/minute for the 70B model) and can
record token usage, so experiments can report cost the way the paper does.
"""

import random
import re
import threading
import time
from functools import lru_cache
from typing import Callable, Optional

from langchain_groq import ChatGroq

from config import GROQ_MODEL, GROQ_REASONING_EFFORT


class DailyLimitError(RuntimeError):
    """Groq's per-day token/request cap for a model is used up; retrying won't help soon."""


def is_daily_limit_error(exc: Exception) -> bool:
    msg = str(exc)
    return "per day" in msg or "(TPD)" in msg or "(RPD)" in msg


def is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc)
    return "rate_limit_exceeded" in msg or "413" in msg or "429" in msg or "Request too large" in msg


def suggested_wait_seconds(exc: Exception, default: float) -> float:
    """Groq 429 messages include 'Please try again in 7.66s' — honor it."""
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", str(exc))
    if m:
        minutes = float(m.group(1) or 0)
        return min(minutes * 60 + float(m.group(2)) + 1.0, 90.0)
    return default


@lru_cache(maxsize=16)
def get_chat_model(model: str, max_tokens: int, temperature: float) -> ChatGroq:
    # gpt-oss only: Qwen3 answers directly without the parameter, and passing
    # it there switches hidden reasoning ON (empty replies at short budgets);
    # non-reasoning models such as allam-2-7b reject it outright.
    reasoning = GROQ_REASONING_EFFORT and "gpt-oss" in model
    extra = {"reasoning_effort": GROQ_REASONING_EFFORT} if reasoning else {}
    return ChatGroq(model=model, temperature=temperature, max_tokens=max_tokens, **extra)


class Usage:
    """Thread-safe token counter (agents in a debate round may run concurrently)."""

    def __init__(self):
        self._lock = threading.Lock()
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0

    def add(self, message) -> None:
        meta = getattr(message, "usage_metadata", None) or {}
        with self._lock:
            self.calls += 1
            self.input_tokens += int(meta.get("input_tokens", 0) or 0)
            self.output_tokens += int(meta.get("output_tokens", 0) or 0)

    def to_dict(self) -> dict:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
        }


def invoke(
    prompt: str,
    *,
    model: Optional[str] = None,
    max_tokens: int = 2048,
    temperature: float = 0.1,
    retries: int = 2,
    usage: Optional[Usage] = None,
):
    """Single-turn chat completion with backoff on Groq rate-limit / too-large errors."""
    chat = get_chat_model(model or GROQ_MODEL, max_tokens, temperature)
    for attempt in range(retries + 1):
        try:
            response = chat.invoke(prompt)
            if usage is not None:
                usage.add(response)
            return response
        except Exception as e:
            if is_daily_limit_error(e):
                m = re.search(r"try again in ([\dhm.]+?s)", str(e))
                raise DailyLimitError(
                    f"Groq's daily limit for {model or GROQ_MODEL} is used up"
                    + (f"; it frees up in about {m.group(1)}" if m else "")
                    + ". Wait, or set GROQ_MODEL / MADAM_MODEL to another model."
                ) from e
            if attempt < retries and is_rate_limit_error(e):
                # Groq's hint ("try again in 2.8s") is too optimistic when several
                # debate agents share the per-minute budget, so back off
                # exponentially, never below the hint, with jitter so concurrent
                # agents don't all retry at the same instant.
                hint = suggested_wait_seconds(e, default=0.0)
                wait = min(max(hint, 3.0 * 2**attempt), 60.0) + random.uniform(0, 2)
                print(f"      [WARN] Groq rate limit hit, retrying in {wait:.0f}s ...")
                time.sleep(wait)
                continue
            raise


LLMCall = Callable[[str, int], str]


def make_llm_call(
    model: Optional[str] = None,
    *,
    temperature: float = 0.0,
    usage: Optional[Usage] = None,
    retries: int = 8,
) -> LLMCall:
    """
    A `(prompt, max_tokens) -> text` function, the shape the debate engine and
    baselines take. Temperature 0 approximates the reference code's greedy
    decoding (`do_sample=False`).
    """

    def call(prompt: str, max_tokens: int) -> str:
        response = invoke(
            prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            retries=retries,
            usage=usage,
        )
        return str(response.content).strip()

    return call
