"""
Tests for the MADAM-RAG engine, parsers and RAMDocs metric. No network: the
LLM is a scripted fake.

    cd fact_checker_simple && python -m pytest tests -q
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GROQ_API_KEY", "test")  # llm.py builds clients lazily; never called here

from madam_rag import QATask, debate, parse_answer_list, run_debate  # noqa: E402
from madam_verify import (  # noqa: E402
    ClaimVerificationTask,
    best_passage,
    build_sources,
    is_low_value,
    verdict_from_record,
)
from ramdocs import score_answers, split_free_answers  # noqa: E402


# ── Parsing ──────────────────────────────────────────────────────────────────

def test_parse_answer_list_formats():
    assert parse_answer_list('All Correct Answers: ["1963", "1956"]. Explanation: x') == ["1963", "1956"]
    assert parse_answer_list("All Correct Answers: ['3,559 people']. Explanation: x") == ["3,559 people"]
    assert parse_answer_list("**All Correct Answers:** [1963, 1956]. Explanation: x") == ["1963", "1956"]
    assert parse_answer_list("All Correct Answers: []. Explanation: unknown") == []
    assert parse_answer_list('All Correct Answers: ["unknown"]. Explanation: none') == []


def test_qa_agent_parse():
    task = QATask("q")
    r = task.parse_agent("Answer: 1963. Explanation: The document says 1963.", 0, 1)
    assert r.answer == "1963"
    assert r.explanation.startswith("The document says")


def test_split_free_answers():
    assert split_free_answers("1963, 1956") == ["1963", "1956"]
    assert split_free_answers("3,559 people") == ["3,559 people"]
    assert split_free_answers("- Paris\n- Lyon") == ["Paris", "Lyon"]


# ── Metric ───────────────────────────────────────────────────────────────────

def test_strict_exact_match():
    gold, wrong = ["1963", "1956"], ["1998"]
    assert score_answers(["1963", "1956"], gold, wrong)["correct"]
    # Missing a valid answer for the ambiguous question -> wrong
    m = score_answers(["1963"], gold, wrong)
    assert not m["correct"] and m["recall"] == 0.5 and m["precision"] == 1.0
    # Including the misinformation answer -> wrong even with full recall
    m = score_answers(["1963", "1956", "1998"], gold, wrong)
    assert not m["correct"] and m["wrong_found"] == ["1998"]
    # The gold answer must appear inside a prediction (whole words)...
    assert score_answers(["Blitzen Trapper (band)"], ["Blitzen Trapper"], [])["correct"]
    assert not score_answers(["1"], ["1963"], [])["correct"]
    # Unicode dashes match ASCII ones
    assert score_answers(["operatic mezzo‑soprano (opera singer)"], ["Operatic mezzo-soprano"], [])["correct"]
    # ...a shorter form only passes the lenient variant
    m = score_answers(["3,559"], ["3,559 people"], ["10,000 people"])
    assert not m["correct"] and m["correct_lenient"]


# ── Engine ───────────────────────────────────────────────────────────────────

class FakeLLM:
    """Agents answer from a per-document script; records every prompt."""

    def __init__(self, round1: dict, round2: dict):
        self.round1, self.round2 = round1, round2
        self.prompts: list[str] = []
        self.aggregations = 0

    def __call__(self, prompt: str, max_tokens: int) -> str:
        self.prompts.append(prompt)
        if prompt.startswith("You are an aggregator"):
            self.aggregations += 1
            return f'All Correct Answers: ["agg{self.aggregations}"]. Explanation: round {self.aggregations}.'
        doc = re.search(r"Document: (\S+)", prompt).group(1)
        script = self.round2 if "other agents as additional information" in prompt else self.round1
        return f"Answer: {script[doc]}. Explanation: because {doc}."


def test_converged_debate_uses_previous_round_aggregation():
    llm = FakeLLM({"d1": "1963", "d2": "1956"}, {"d1": "1963", "d2": "1956"})
    record = debate(QATask("When?"), ["d1", "d2"], llm, num_rounds=3)
    assert record["rounds_used"] == 2
    assert record["converged"] and record["converged_round"] == 2
    assert llm.aggregations == 1  # converged round is not re-aggregated
    assert record["final"]["answers"] == ["agg1"]


def test_changed_answers_keep_debating_until_max_rounds():
    llm = FakeLLM({"d1": "1963", "d2": "1998"}, {"d1": "1963", "d2": "1963"})
    record = debate(QATask("When?"), ["d1", "d2"], llm, num_rounds=2)
    assert record["rounds_used"] == 2 and not record["converged"]
    assert llm.aggregations == 2
    assert record["final"]["answers"] == ["agg2"]
    assert record["rounds"][1][1]["changed"] is True
    assert record["rounds"][1][0]["changed"] is False


def test_history_is_other_agents_previous_responses():
    llm = FakeLLM({"d1": "A", "d2": "B", "d3": "C"}, {"d1": "A", "d2": "B", "d3": "C"})
    debate(QATask("q"), ["d1", "d2", "d3"], llm, num_rounds=2)
    agent1_round2 = next(p for p in llm.prompts if "Document: d1" in p and "additional information" in p)
    assert "Agent 2: Answer: B" in agent1_round2 and "Agent 3: Answer: C" in agent1_round2
    assert "Agent 1:" not in agent1_round2


def test_concurrent_agents_preserve_order_and_events():
    llm = FakeLLM({f"d{i}": str(i) for i in range(5)}, {f"d{i}": str(i) for i in range(5)})
    events = list(run_debate(QATask("q"), [f"d{i}" for i in range(5)], llm, num_rounds=2, concurrency=3))
    record = events[-1]["record"]
    assert [a["answer"] for a in record["rounds"][0]] == ["0", "1", "2", "3", "4"]
    thinking = [e for e in events if e["type"] == "agent_thinking"]
    assert len(thinking) == 10
    assert events[0]["type"] == "debate_start" and events[-1]["type"] == "debate_end"


def test_no_documents():
    record = debate(QATask("q"), [], FakeLLM({}, {}), num_rounds=2)
    assert record["final"] is None and record["rounds_used"] == 0


# ── Claim verification adaptation ────────────────────────────────────────────

def test_claim_aggregation_parse():
    raw = """Verdict: REFUTES
Confidence: 85%
Reliable Agents: [1, 3]
Unreliable Agents: [2]
Irrelevant Agents: none
Ambiguity: none
Explanation: Agents 1 and 3 show the figure was 3,559."""
    agg = ClaimVerificationTask("c", "today").parse_aggregation(raw, 1).to_dict()
    assert agg["verdict"] == "REFUTES" and agg["confidence"] == 0.85
    assert agg["reliable_agents"] == [0, 2] and agg["unreliable_agents"] == [1]
    assert agg["irrelevant_agents"] == [] and agg["ambiguity"] == ""


def test_claim_agent_parse_and_convergence():
    task = ClaimVerificationTask("c", "today")
    a = task.parse_agent("Verdict: NOT ENOUGH INFO. Answer: unknown. Explanation: n/a.", 0, 1)
    b = task.parse_agent("**Verdict:** NOT_ENOUGH_INFO. Answer: x. Explanation: y.", 0, 2)
    assert a.verdict == b.verdict == "NOT_ENOUGH_INFO" and task.unchanged(a, b)


def test_sources_and_verdict():
    results = [
        {"title": "A", "url": "https://www.a.com/1", "snippet": "Broken Bow had 3,559 people in 2010 census data."},
        {"title": "A2", "url": "https://a.com/2", "snippet": "More Broken Bow census numbers for the city of 2010."},
        {"title": "A3", "url": "https://a.com/3", "snippet": "Third page from the same site about Broken Bow pop."},
        {"title": "B", "url": "https://b.org/x", "snippet": "tiny"},
        {"title": "P", "url": "https://au.pinterest.com/pin/1", "snippet": "Broken Bow population pin with lots of words."},
        {"title": "F", "url": "https://www.facebook.com/x", "snippet": "Broken Bow census post with plenty of words in it."},
        {"title": "C", "url": "https://c.net/y", "snippet": "Census Bureau figures for Broken Bow, Nebraska in 2010."},
    ]
    sources = build_sources("Broken Bow population 3,559", results, {}, max_sources=5)
    # one seat per site, short snippet dropped, social sites skipped
    assert [s["domain"] for s in sources] == ["a.com", "c.net"]
    record = {"final": {"verdict": "SUPPORTS", "confidence": 0.8, "explanation": "ok",
                        "reliable_agents": [0], "unreliable_agents": [1], "ambiguity": ""}}
    v = verdict_from_record("c", record, sources)
    assert v["verdict"] == "SUPPORTS" and "https://www.a.com/1" in v["justification"]
    assert "Flagged as unreliable: c.net" in v["justification"]


def test_low_value_domains():
    assert is_low_value("pinterest.com") and is_low_value("au.pinterest.com")
    assert is_low_value("m.facebook.com") and is_low_value("x.com") and is_low_value("threads.com")
    assert not is_low_value("netflix.com") and not is_low_value("reuters.com")


def test_best_passage_finds_claim_window():
    filler = "lorem ipsum dolor sit amet " * 60
    page = filler + "the 2010 census counted 3559 residents in Broken Bow Nebraska " + filler
    assert "3559" in best_passage(page, "Broken Bow had 3559 residents in 2010")


# ── Aggregator validation (claim task only) ──────────────────────────────────

INVENTED = """Claim: The Great Barrier Reef is the largest coral reef system.
Agent responses:
- Agent 1: Verdict: SUPPORTS. Answer: x. Explanation: y.
Verdict: SUPPORTS
Confidence: 0.8
Reliable Agents: [1, 4]
Unreliable Agents: [2]
Irrelevant Agents: [3]
Ambiguity: none
Explanation: made up."""

GOOD = """Verdict: REFUTES
Confidence: 0.7
Reliable Agents: [2]
Unreliable Agents: []
Irrelevant Agents: [1]
Ambiguity: none
Explanation: Agent 2's source contradicts the claim."""


class ScriptedClaimLLM:
    """Agents: A1 NEI, A2 REFUTES (both rounds). Aggregator replies from a queue."""

    def __init__(self, aggregator_replies):
        self.replies = list(aggregator_replies)
        self.aggregator_prompts = []

    def __call__(self, prompt, max_tokens):
        if prompt.startswith("You are an aggregator"):
            self.aggregator_prompts.append(prompt)
            return self.replies.pop(0)
        if "Document: d1" in prompt:
            return "Verdict: NOT_ENOUGH_INFO. Answer: unknown. Explanation: off-topic."
        return "Verdict: REFUTES. Answer: it was 1990. Explanation: the source says so."


def test_invented_claim_is_retried():
    llm = ScriptedClaimLLM([INVENTED, GOOD])
    record = debate(ClaimVerificationTask("c", "today"), ["d1", "d2"], llm, num_rounds=1)
    assert len(llm.aggregator_prompts) == 2
    assert "Do not write another example" in llm.aggregator_prompts[1]
    assert record["final"]["verdict"] == "REFUTES" and not record["final"].get("rejected")


def test_repeated_bad_aggregation_falls_back_to_majority():
    llm = ScriptedClaimLLM([INVENTED, INVENTED])
    sources = [{"agent": 0, "url": "https://a.org", "domain": "a.org"},
               {"agent": 1, "url": "https://b.org", "domain": "b.org"}]
    record = debate(ClaimVerificationTask("c", "today"), ["d1", "d2"], llm, num_rounds=1)
    assert record["final"]["rejected"]
    v = verdict_from_record("c", record, sources)
    assert v["verdict"] == "REFUTES" and v["confidence"] == 0.25
    assert "couldn't be used" in v["justification"]


def test_qa_task_never_retries_aggregator():
    llm = FakeLLM({"d1": "A"}, {"d1": "A"})
    debate(QATask("q"), ["d1"], llm, num_rounds=1)
    assert llm.aggregations == 1


# ── Grouped debate (news) ────────────────────────────────────────────────────

from madam_verify import merge_duplicate_sources, run_grouped_debate  # noqa: E402

WIRE = ("PARIS (AP) The Eiffel Tower now stands 330 metres tall after engineers fitted "
        "a new digital radio antenna to its summit on Tuesday, officials said.")


def _src(i, domain, text):
    return {"agent": i, "domain": domain, "url": f"https://{domain}/a", "title": domain, "text": text}


def test_syndicated_copies_share_an_agent():
    sources = [_src(0, "apnews.com", WIRE), _src(1, "abcnews.go.com", WIRE + " Read more."),
               _src(2, "lemonde.fr", "Le monument mesure 324 metres selon une ancienne fiche.")]
    merged = merge_duplicate_sources(sources)
    assert [s["domain"] for s in merged] == ["apnews.com", "lemonde.fr"]
    assert merged[0]["also"][0]["domain"] == "abcnews.go.com" and merged[1]["agent"] == 1


class GroupLLM:
    """Agents answer from a per-source script; advocates and aggregator are scripted."""

    def __init__(self, verdicts, advocate=None):
        self.verdicts, self.advocate, self.calls = verdicts, advocate or {}, []

    def __call__(self, prompt, max_tokens):
        self.calls.append(prompt)
        if prompt.startswith("You are an aggregator"):
            return "Verdict: SUPPORTS\nConfidence: 0.8\nReliable Agents: [1]\nUnreliable Agents: [2]\nIrrelevant Agents: []\nAmbiguity: none\nExplanation: ok."
        if prompt.startswith("You are the advocate"):
            side = "SUPPORTS" if "(SUPPORTS)" in prompt.split("\n")[0] else "REFUTES"
            v = self.advocate.get(side, side)
            return f"Verdict: {v}. Answer: argued. Explanation: weighed both groups."
        domain = re.search(r"\(Source: ([^)]+)\)", prompt).group(1)
        return f"Verdict: {self.verdicts[domain]}. Answer: fact from {domain}. Explanation: e."


def test_unanimous_sources_skip_the_group_round():
    sources = [_src(0, "a.com", "x"), _src(1, "b.com", "y"), _src(2, "c.com", "z")]
    llm = GroupLLM({"a.com": "SUPPORTS", "b.com": "SUPPORTS", "c.com": "NOT_ENOUGH_INFO"})
    events = list(run_grouped_debate("c", sources, llm, today="t", concurrency=1))
    record = events[-1]["record"]
    assert len(llm.calls) == 4  # 3 reads + 1 aggregator
    assert record["camps"] == [{"stance": "SUPPORTS", "members": [0, 1]}] and record["set_aside"] == [2]
    assert record["rounds_used"] == 1 and record["final"]["verdict"] == "SUPPORTS"
    assert any(e["type"] == "camps" for e in events)


def test_disputed_claim_gets_one_advocate_per_group():
    sources = [_src(0, "a.com", "x"), _src(1, "b.com", "y"), _src(2, "c.com", "z")]
    llm = GroupLLM({"a.com": "SUPPORTS", "b.com": "REFUTES", "c.com": "SUPPORTS"},
                   advocate={"REFUTES": "SUPPORTS"})  # the Refutes group concedes
    events = list(run_grouped_debate("c", sources, llm, today="t", concurrency=1))
    record = events[-1]["record"]
    assert len(llm.calls) == 3 + 2 + 1
    responses = [e for e in events if e["type"] == "camp_response"]
    assert {r["stance"]: r["conceded"] for r in responses} == {"SUPPORTS": False, "REFUTES": True}
    second = record["rounds"][1]
    assert second[1]["verdict"] == "SUPPORTS" and second[1]["changed"] is True
    assert second[0]["changed"] is False
    advocate = next(p for p in llm.calls if p.startswith("You are the advocate"))
    assert "Agent 1 (a.com)" in advocate and "The opposing group (REFUTES)" in advocate


def test_off_topic_results_get_no_seat():
    from madam_verify import is_relevant
    claim = "Mount Everest is exactly 8,848 metres tall according to the latest official survey"
    assert not is_relevant(claim, "AAA Gas Prices: today's national average, latest official prices by state")
    assert is_relevant(claim, "How tall is Mount Everest? The 2020 survey measured 8,848.86 metres")
    sources = build_sources(claim, [
        {"title": "AAA Gas Prices", "url": "https://gasprices.aaa.com/", "snippet": "Today's latest official national average gas prices."},
        {"title": "Everest height", "url": "https://himalayanclub.org/x", "snippet": "Mount Everest was resurveyed at 8,848.86 metres in 2020."},
    ], {})
    assert [s["domain"] for s in sources] == ["himalayanclub.org"]
