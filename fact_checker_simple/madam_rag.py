"""
madam_rag.py — MADAM-RAG: Multi-agent Debate for Ambiguity and Misinformation in RAG

Implements Wang, Prasad, Stengel-Eskin & Bansal, "Retrieval-Augmented Generation
with Conflicting Evidence" (COLM 2025, arXiv:2504.13079).

Each retrieved document gets its own agent, which answers from that document
alone. An aggregator reads all agents' answers and collates every answer that
holds up (several, when the question is ambiguous) while discarding
misinformation and noise. In later rounds each agent also sees the other
agents' previous answers and may defend or revise its own. The debate stops
early once no agent changes its answer.

Faithfulness to the reference implementation (github.com/HanNight/RAMDocs,
run_madam_rag.py), which produced the paper's numbers:
  * QA prompts are reproduced verbatim, typos included, with the aggregator's
    few-shot Michael Jordan example.
  * From round 2 on, an agent's history is the OTHER agents' full responses
    from the previous round. (Section 4 of the paper describes passing the
    aggregator's summary instead; the released code does not do that.)
  * Greedy decoding with 128 new tokens per call.
  * Early stop: when every agent's normalized answer contains, or is contained
    in, its previous-round answer, the debate has converged and the final
    answer is the PREVIOUS round's aggregation. The converged round is never
    re-aggregated.
  * The paper also says agent responses are shuffled before aggregation to
    reduce position bias, but the code doesn't shuffle. It's available here as
    an opt-in (`shuffle=True`) and off by default.

The engine is task-agnostic. `QATask` is the paper's question-answering setup,
used for RAMDocs; `madam_verify.ClaimVerificationTask` adapts it to checking a
news claim against web sources.
"""

import ast
import json
import queue
import random
import re
import string
import threading
from dataclasses import dataclass, field
from typing import Iterator, Optional

from llm import LLMCall

# Debate rounds. The paper uses T=3; see run_debate for why 2 is the default here.
DEFAULT_ROUNDS = 2
MAX_ROUNDS = 3


# ── Answer normalization (verbatim from the reference code) ─────────────────

def normalize_answer(s: str) -> str:
    def remove_articles(text):
        return re.sub(r"\b(a|an|the)\b", " ", text)

    def white_space_fix(text):
        return " ".join(text.split())

    def remove_punc(text):
        return "".join(ch for ch in text if ch not in string.punctuation)

    def lower(text):
        return text.lower()

    return white_space_fix(remove_articles(remove_punc(lower(s))))


# ── Parsing helpers ──────────────────────────────────────────────────────────

def _strip_markdown(text: str) -> str:
    return text.replace("**", "").replace("__", "")


def _field(text: str, name: str, next_names: list[str]) -> str:
    """Value after `name:` up to the next known field label (or end of text)."""
    stop = "|".join(re.escape(n) for n in next_names)
    lookahead = rf"(?=\n?\s*(?:{stop})\s*:)" if stop else r"$"
    m = re.search(rf"{re.escape(name)}\s*:\s*(.*?)\s*(?:{lookahead}|$)", text, re.S | re.I)
    return m.group(1).strip() if m else ""


def parse_answer_list(text: str) -> list[str]:
    """
    Pull the answers out of "All Correct Answers: [...]". Accepts JSON or
    Python list syntax, and falls back to splitting a bare comma list.
    Returns [] for 'unknown'.
    """
    text = _strip_markdown(text)
    m = re.search(r"All Correct Answers\s*:\s*(\[.*?\])", text, re.S | re.I)
    items: list[str] = []
    if m:
        blob = m.group(1)
        for loader in (json.loads, ast.literal_eval):
            try:
                parsed = loader(blob)
                if isinstance(parsed, (list, tuple)):
                    items = [str(x) for x in parsed]
                    break
            except Exception:
                continue
        else:
            items = [x.strip().strip("'\"") for x in blob.strip("[]").split(",")]
    else:
        bare = _field(text, "All Correct Answers", ["Explanation"])
        if bare:
            items = [x.strip().strip("'\"") for x in re.split(r";|\n|, (?=\D)", bare)]

    out = []
    for item in items:
        item = item.strip().rstrip(".").strip()
        if item and normalize_answer(item) not in ("", "unknown", "none"):
            out.append(item)
    return out


# ── Debate data types ────────────────────────────────────────────────────────

@dataclass
class AgentReply:
    agent: int
    round: int
    raw: str
    answer: str
    explanation: str
    verdict: Optional[str] = None  # claim-verification task only
    changed: bool = False

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "round": self.round,
            "answer": self.answer,
            "explanation": self.explanation,
            "verdict": self.verdict,
            "changed": self.changed,
            "raw": self.raw,
        }


@dataclass
class Aggregation:
    round: int
    raw: str
    answers: list[str]
    explanation: str
    extra: dict = field(default_factory=dict)  # task-specific fields (verdict, flagged agents…)

    def to_dict(self) -> dict:
        return {
            "round": self.round,
            "raw": self.raw,
            "answers": self.answers,
            "explanation": self.explanation,
            **self.extra,
        }


class DebateTask:
    """Prompting and parsing hooks for one debate. Subclass per task."""

    agent_max_tokens = 128
    aggregator_max_tokens = 128

    def agent_prompt(self, document: str, history: str) -> str:
        raise NotImplementedError

    def parse_agent(self, raw: str, agent: int, round_: int) -> AgentReply:
        raise NotImplementedError

    def aggregator_prompt(self, responses: list[tuple[int, str]]) -> str:
        """`responses` is [(agent_index, raw_response)] in presentation order."""
        raise NotImplementedError

    def parse_aggregation(self, raw: str, round_: int) -> Aggregation:
        raise NotImplementedError

    def unchanged(self, prev: AgentReply, cur: AgentReply) -> bool:
        """Has this agent kept its answer since the previous round?"""
        raise NotImplementedError

    def aggregation_problem(self, agg: Aggregation, num_agents: int) -> Optional[str]:
        """
        Why this aggregation can't be used, or None if it's fine. A non-None
        answer makes the engine re-ask the aggregator once with retry_suffix.
        The paper's QA task accepts everything, as the reference code does.
        """
        return None

    retry_suffix = ""


# ── The paper's QA task ──────────────────────────────────────────────────────

class QATask(DebateTask):
    """Question answering over conflicting documents, as in RAMDocs / AmbigDocs."""

    def __init__(self, question: str):
        self.question = question

    def agent_prompt(self, document: str, history: str) -> str:
        query = self.question
        # Verbatim from run_madam_rag.py, typos and the stray trailing quote included.
        if history:
            return f"""You are an agent reading a document to answer a question.

Question: {query}
Document: {document}

The following reponses are from other agents as additional information.
{history}
Answer the question based on the document and other agents' response. Provide your answer and a step-by-step reasoning explanation.
Please follow the format: 'Answer: {{}}. Explanation: {{}}.''"""
        return f"""You are an agent reading a document to answer a question.

Question: {query}
Document: {document}

Answer the question based only on this document. Provide your answer and a step-by-step reasoning explanation.
Please follow the format: 'Answer: {{}}. Explanation: {{}}.''"""

    def parse_agent(self, raw: str, agent: int, round_: int) -> AgentReply:
        text = _strip_markdown(raw)
        answer = _field(text, "Answer", ["Explanation"])
        explanation = _field(text, "Explanation", [])
        if not answer and not explanation:
            answer, explanation = text.split("\n", 1)[0], text
        return AgentReply(
            agent=agent,
            round=round_,
            raw=raw,
            answer=answer.rstrip(".").strip(),
            explanation=explanation or text,
        )

    def aggregator_prompt(self, responses: list[tuple[int, str]]) -> str:
        query = self.question
        joined = "\n".join(f"Agent {i + 1}: {r}" for i, r in responses)
        return f"""You are an aggregator reading answers from multiple agents.

If there are multiple answers, please provide all possible correct answers and also provide a step-by-step reasoning explanation. If there is no correct answer, please reply 'unknown'.
Please follow the format: 'All Correct Answers: []. Explanation: {{}}.'

The following are examples:
Question: In which year was Michael Jordan born?
Agent responses:
Agent 1: Answer: 1963. Explanation: The document clearly states that Michael Jeffrey Jordan was born on February 17, 1963.
Agent 2: Answer: 1956. Explanation: The document states that Michael Irwin Jordan was born on February 25, 1956. However, it's important to note that this document seems to be about a different Michael Jordan, who is an American scientist, not the basketball player. The other agents' responses do not align with the information provided in the document.
Agent 3: Answer: 1998. Explanation: The According to the document provided, Michael Jeffrey Jordan was born on February 17, 1998.
Agent 4: Answer: Unknown. Explanation: The provided document focuses on Jordan's college and early professional career, mentioning his college championship in 1982 and his entry into the NBA in 1984, but it does not include information about his birth year.
All Correct Answers: ["1963", "1956"]. Explanation: Agent 1 is talking about the basketball player Michael Jeffrey Jordan, who was born on Februray 17, 1963, so 1963 is correct. Agent 2 is talking about another person named Michael Jordan, who is an American scientist, and he was born in 1956. Therefore, the answer 1956 from Agent 2 is also correct. Agent 3 provides an error stating Michael Jordan's birth year as 1998, which is incorrect. Based on the correct information from Agent 1, Michael Jeffrey Jordan was born on February 17, 1963. Agent 4 does not provide any useful information.

Question: {query}
Agent responses:
{joined}
"""

    def parse_aggregation(self, raw: str, round_: int) -> Aggregation:
        text = _strip_markdown(raw)
        return Aggregation(
            round=round_,
            raw=raw,
            answers=parse_answer_list(text),
            explanation=_field(text, "Explanation", []) or text,
        )

    def unchanged(self, prev: AgentReply, cur: AgentReply) -> bool:
        # Reference convergence test: either normalized answer contains the other.
        a, b = normalize_answer(cur.answer), normalize_answer(prev.answer)
        return a in b or b in a


# ── Debate engine ────────────────────────────────────────────────────────────

def _run_agents(
    prompts: list[str], llm_call: LLMCall, max_tokens: int, concurrency: int
) -> Iterator[tuple]:
    """
    Run one round's agent calls, yielding ("start", i) when agent i begins and
    ("done", i, text) when it answers, so a UI can show who is thinking.
    """
    if concurrency <= 1:
        for i, p in enumerate(prompts):
            yield ("start", i)
            yield ("done", i, llm_call(p, max_tokens))
        return

    events: queue.Queue = queue.Queue()
    slots = threading.Semaphore(concurrency)

    def worker(i: int, p: str):
        with slots:
            events.put(("start", i))
            try:
                events.put(("done", i, llm_call(p, max_tokens)))
            except Exception as e:  # surfaced in the generator thread below
                events.put(("error", i, e))

    threads = [threading.Thread(target=worker, args=(i, p), daemon=True) for i, p in enumerate(prompts)]
    for t in threads:
        t.start()
    remaining = len(prompts)
    while remaining:
        ev = events.get()
        if ev[0] == "error":
            raise ev[2]
        if ev[0] == "done":
            remaining -= 1
        yield ev


def run_debate(
    task: DebateTask,
    documents: list[str],
    llm_call: LLMCall,
    *,
    num_rounds: int = DEFAULT_ROUNDS,
    concurrency: int = 1,
    shuffle: bool = False,
    seed: int = 42,
) -> Iterator[dict]:
    """
    Run a MADAM-RAG debate, yielding progress events:

      {"type": "debate_start", "num_agents", "max_rounds"}
      {"type": "round_start", "round"}
      {"type": "agent_thinking", "round", "agent"}
      {"type": "agent_response", "round", "agent", "answer", "explanation", "verdict", "changed", "raw"}
      {"type": "aggregator_thinking", "round"}
      {"type": "aggregation", "round", "aggregation": {...}}
      {"type": "converged", "round"}       # early stop: no agent changed its answer
      {"type": "debate_end", "record": {...}}   # always last

    `round` is 1-based, as in the paper; `agent` is the 0-based document index.

    The paper runs T=3 rounds; this project defaults to 2 (DEFAULT_ROUNDS).
    The paper's own ablation (Figure 3, Llama3.3-70B on RAMDocs) scores round 2
    at 36.8 accuracy vs 34.4 at round 3, and Appendix D notes most debates
    converge within 1-2 rounds, so the third round mostly costs tokens.
    """
    n = len(documents)
    rng = random.Random(seed)
    yield {"type": "debate_start", "num_agents": n, "max_rounds": num_rounds}

    rounds: list[list[AgentReply]] = []
    aggregations: list[Aggregation] = []
    final: Optional[Aggregation] = None
    converged_round: Optional[int] = None

    for r in range(1, num_rounds + 1):
        if n == 0:
            break
        yield {"type": "round_start", "round": r}
        prev = rounds[-1] if rounds else None

        prompts = []
        for i, doc in enumerate(documents):
            history = ""
            if prev is not None:
                history = "\n".join(f"Agent {j + 1}: {prev[j].raw}" for j in range(n) if j != i)
            prompts.append(task.agent_prompt(doc, history))

        replies: list[Optional[AgentReply]] = [None] * n
        for ev in _run_agents(prompts, llm_call, task.agent_max_tokens, concurrency):
            if ev[0] == "start":
                yield {"type": "agent_thinking", "round": r, "agent": ev[1]}
                continue
            i, raw = ev[1], ev[2]
            reply = task.parse_agent(raw, i, r)
            reply.changed = prev is not None and not task.unchanged(prev[i], reply)
            replies[i] = reply
            yield {"type": "agent_response", **reply.to_dict()}
        current: list[AgentReply] = replies  # type: ignore[assignment]
        rounds.append(current)

        # Early stop (rounds >= 2): every agent kept its answer, so the previous
        # round's aggregation stands — matching the reference code.
        if prev is not None and all(task.unchanged(prev[i], current[i]) for i in range(n)):
            converged_round = r
            yield {"type": "converged", "round": r}
            break

        order = list(range(n))
        if shuffle:
            rng.shuffle(order)
        yield {"type": "aggregator_thinking", "round": r}
        agg_prompt = task.aggregator_prompt([(i, current[i].raw) for i in order])
        agg = task.parse_aggregation(llm_call(agg_prompt, task.aggregator_max_tokens), r)
        problem = task.aggregation_problem(agg, n)
        if problem:
            print(f"      [WARN] Aggregator output rejected ({problem}); asking again")
            retry = task.parse_aggregation(
                llm_call(agg_prompt + task.retry_suffix, task.aggregator_max_tokens), r
            )
            if not task.aggregation_problem(retry, n):
                agg = retry
            else:
                agg.extra["rejected"] = problem  # callers must not trust this ruling
        aggregations.append(agg)
        final = agg
        yield {"type": "aggregation", "round": r, "aggregation": agg.to_dict()}

    record = {
        "num_agents": n,
        "max_rounds": num_rounds,
        "rounds_used": len(rounds),
        "converged": converged_round is not None,
        "converged_round": converged_round,
        "rounds": [[a.to_dict() for a in rnd] for rnd in rounds],
        "aggregations": [a.to_dict() for a in aggregations],
        "final": final.to_dict() if final else None,
    }
    yield {"type": "debate_end", "record": record}


def debate(task: DebateTask, documents: list[str], llm_call: LLMCall, **kwargs) -> dict:
    """Blocking wrapper: run the debate and return its final record."""
    record = None
    for ev in run_debate(task, documents, llm_call, **kwargs):
        if ev["type"] == "debate_end":
            record = ev["record"]
    return record
