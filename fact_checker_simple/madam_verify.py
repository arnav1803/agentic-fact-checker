"""
madam_verify.py — MADAM-RAG applied to verifying a news claim.

The paper's setup is question answering over conflicting documents. Fact
checking has the same three kinds of conflict:
  ambiguity       two sources describe different people or events that share a name
  misinformation  a source gets the fact wrong
  noise           a source is on-topic but says nothing about the claim
so the same debate applies. Each web source gets an agent that rules on the
claim from that source alone. Agents then see each other's rulings and may
revise. An aggregator issues the verdict and says which sources it relied on,
which look like misinformation, and which were irrelevant.

Two ways to run it:
  run_grouped_debate (default for news): near-duplicate copies of one story
      share an agent; after each source's independent first read, agents form
      a Supports group and a Refutes group whose advocates argue it out, and
      the aggregator rules on the groups. At most n + 3 LLM calls per claim.
  verify_claim_by_debate: the paper's mechanics unchanged (madam_rag.run_debate:
      every agent re-answers every round, seeing the others' answers), with
      claim-verification prompts. 2n + 2 calls per claim at two rounds.
"""

import re
from typing import Iterator, Optional
from urllib.parse import urlparse

from llm import LLMCall
from madam_rag import (
    Aggregation,
    AgentReply,
    DebateTask,
    _field,
    _strip_markdown,
    run_debate,
)

VERDICTS = ("SUPPORTS", "REFUTES", "NOT_ENOUGH_INFO")

_VERDICT_ALIASES = {
    "SUPPORTS": "SUPPORTS", "SUPPORTED": "SUPPORTS", "SUPPORT": "SUPPORTS", "TRUE": "SUPPORTS",
    "REFUTES": "REFUTES", "REFUTED": "REFUTES", "REFUTE": "REFUTES", "FALSE": "REFUTES",
    "NOT_ENOUGH_INFO": "NOT_ENOUGH_INFO", "NOT ENOUGH INFO": "NOT_ENOUGH_INFO",
    "NOT ENOUGH INFORMATION": "NOT_ENOUGH_INFO", "UNVERIFIED": "NOT_ENOUGH_INFO",
    "UNKNOWN": "NOT_ENOUGH_INFO", "NEI": "NOT_ENOUGH_INFO",
}


def normalize_verdict(text: str) -> str:
    t = re.sub(r"[^A-Z_ ]", "", (text or "").upper()).strip()
    if t in _VERDICT_ALIASES:
        return _VERDICT_ALIASES[t]
    for key, value in _VERDICT_ALIASES.items():
        if t.startswith(key):
            return value
    return "NOT_ENOUGH_INFO"


def _agent_list(text: str) -> list[int]:
    """'[1, 3]' or '1 and 3' or 'Agent 2' -> 0-based indices."""
    if re.fullmatch(r"\s*(?:\[\s*\]|none|n/?a|-)?\s*\.?\s*", text or "", re.I):
        return []
    return sorted({int(n) - 1 for n in re.findall(r"\d+", text) if int(n) > 0})


# ── Debate task ──────────────────────────────────────────────────────────────

_AGGREGATOR_EXAMPLE = """Claim: Michael Jordan was born in 1963.
Agent responses:
Agent 1: Verdict: SUPPORTS. Answer: Michael Jeffrey Jordan was born on February 17, 1963. Explanation: The document clearly states that the basketball player Michael Jeffrey Jordan was born on February 17, 1963.
Agent 2: Verdict: REFUTES. Answer: Michael Irwin Jordan was born on February 25, 1956. Explanation: The document states that Michael Irwin Jordan, a professor at UC Berkeley, was born in 1956.
Agent 3: Verdict: REFUTES. Answer: Michael Jeffrey Jordan was born on February 17, 1998. Explanation: According to the document, Michael Jeffrey Jordan was born in Brooklyn on February 17, 1998.
Agent 4: Verdict: NOT_ENOUGH_INFO. Answer: unknown. Explanation: The document covers Jordan's college championship in 1982 and his 1984 NBA draft but not his birth year.
Verdict: SUPPORTS
Confidence: 0.9
Reliable Agents: [1, 2]
Unreliable Agents: [3]
Irrelevant Agents: [4]
Ambiguity: Agent 2 describes a different Michael Jordan (the Berkeley professor, born 1956); the claim is about the basketball player.
Explanation: Agent 1 shows the basketball player Michael Jeffrey Jordan was born in 1963, which matches the claim. Agent 2 is right about a different person, so it does not refute the claim. Agent 3 says 1998, which conflicts with Agent 1 and with Jordan joining the NBA in 1984, so it is misinformation. Agent 4 has no relevant information."""


class ClaimVerificationTask(DebateTask):
    agent_max_tokens = 220
    aggregator_max_tokens = 450

    def __init__(self, claim: str, today: str):
        self.claim = claim
        self.today = today

    def agent_prompt(self, document: str, history: str) -> str:
        head = f"""You are an agent reading a document to verify a claim.
Today's date is {self.today}. The document may report events after your training cutoff; judge the claim from the document, not from memory.

Claim: {self.claim}
Document: {document}
"""
        rules = """- SUPPORTS: the document states facts that confirm the claim.
- REFUTES: the document states facts that contradict the claim.
- NOT_ENOUGH_INFO: the document does not address the claim."""
        fmt = "Please follow the format: 'Verdict: {}. Answer: {}. Explanation: {}.'"
        if history:
            return f"""{head}
The following responses are from other agents as additional information.
{history}

Judge the claim based on the document and other agents' responses. Other documents may describe a different person, place or event with the same name, or may contain misinformation, so weigh their evidence against yours before revising.
{rules}
Provide your verdict, the key fact your document states, and a step-by-step reasoning explanation.
{fmt}"""
        return f"""{head}
Judge the claim based only on this document.
{rules}
Provide your verdict, the key fact your document states, and a step-by-step reasoning explanation.
{fmt}"""

    def parse_agent(self, raw: str, agent: int, round_: int) -> AgentReply:
        text = _strip_markdown(raw)
        verdict_text = _field(text, "Verdict", ["Answer", "Explanation"])
        answer = _field(text, "Answer", ["Explanation"])
        explanation = _field(text, "Explanation", [])
        return AgentReply(
            agent=agent,
            round=round_,
            raw=raw,
            answer=answer.rstrip(".").strip() or "unknown",
            explanation=explanation or text,
            verdict=normalize_verdict(verdict_text.split(".")[0] if verdict_text else text[:40]),
        )

    def aggregator_prompt(self, responses: list[tuple[int, str]]) -> str:
        joined = "\n".join(f"Agent {i + 1}: {r}" for i, r in responses)
        return f"""You are an aggregator reading verdicts from multiple agents. Each agent read a different web source about the same claim. Today's date is {self.today}.

Sources can conflict for different reasons, and each needs different handling:
- Ambiguity: sources describe different entities or events that share a name. Each can be right about its own subject; decide which one the claim is about.
- Misinformation: a source states something that conflicts with better-supported evidence. Do not let it decide the verdict.
- Noise: a source does not address the claim. Ignore it.

Decide whether the claim is supported, refuted, or cannot be decided from these sources, give a confidence between 0 and 1, and explain step by step.
Please follow the format exactly:
Verdict: <SUPPORTS | REFUTES | NOT_ENOUGH_INFO>
Confidence: <number between 0 and 1>
Reliable Agents: [<agents whose evidence you relied on>]
Unreliable Agents: [<agents whose claims look like misinformation>]
Irrelevant Agents: [<agents whose documents do not address the claim>]
Ambiguity: <one sentence if sources describe different entities or events, otherwise none>
Explanation: <step-by-step reasoning>

The following is an example:
{_AGGREGATOR_EXAMPLE}

Claim: {self.claim}
Agent responses:
{joined}

Now give your judgment for this claim only, starting with "Verdict:".
"""

    # Seen with openai/gpt-oss-120b: instead of judging, the model sometimes
    # invents a further worked example (a new claim with new agents) and rules
    # on that. The engine re-asks once with this suffix.
    retry_suffix = (
        "\nDo not write another example. Judge only the claim above, using only the "
        "agents listed above, and start your reply with \"Verdict:\"."
    )

    def aggregation_problem(self, agg: Aggregation, num_agents: int) -> Optional[str]:
        raw = _strip_markdown(agg.raw)
        verdict_at = re.search(r"Verdict\s*:", raw, re.I)
        if not verdict_at:
            return "no verdict"
        if re.search(r"^\s*Claim\s*:", raw[: verdict_at.start()], re.I | re.M):
            return "it judged a different, invented claim"
        cited = (agg.extra.get("reliable_agents", []) + agg.extra.get("unreliable_agents", [])
                 + agg.extra.get("irrelevant_agents", []))
        if any(i >= num_agents for i in cited):
            return "it cited agents that don't exist"
        return None

    def parse_aggregation(self, raw: str, round_: int) -> Aggregation:
        text = _strip_markdown(raw)
        labels = ["Verdict", "Confidence", "Reliable Agents", "Unreliable Agents",
                  "Irrelevant Agents", "Ambiguity", "Explanation"]

        def get(name):
            return _field(text, name, [l for l in labels if l != name])

        verdict = normalize_verdict(get("Verdict"))
        try:
            confidence = float(re.findall(r"\d*\.?\d+", get("Confidence"))[0])
            if confidence > 1:
                confidence /= 100  # "85" or "85%"
        except (IndexError, ValueError):
            confidence = 0.5
        ambiguity = get("Ambiguity").strip()
        if re.fullmatch(r"(none|no|n/?a|-)\.?", ambiguity, re.I):
            ambiguity = ""
        return Aggregation(
            round=round_,
            raw=raw,
            answers=[verdict],
            explanation=get("Explanation") or text,
            extra={
                "verdict": verdict,
                "confidence": round(max(0.0, min(1.0, confidence)), 3),
                "reliable_agents": _agent_list(get("Reliable Agents")),
                "unreliable_agents": _agent_list(get("Unreliable Agents")),
                "irrelevant_agents": _agent_list(get("Irrelevant Agents")),
                "ambiguity": ambiguity,
            },
        )

    def unchanged(self, prev: AgentReply, cur: AgentReply) -> bool:
        return prev.verdict == cur.verdict


# ── Turning search results into agent documents ─────────────────────────────

_STOPWORDS = set("""a an the and or but of to in on at by for with from as is are was were be been
being that this these those it its into over under than then their there they he she his her
has have had will would can could should may might not no yes said says about after before""".split())


def _terms(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOPWORDS and len(w) > 2}


def best_passage(page_text: str, claim: str, words: int = 140, step: int = 35) -> str:
    """
    The window of page text that shares the most terms with the claim. RAMDocs
    documents are ~100-word chunks, so agents here get a similar amount.
    """
    tokens = page_text.split()
    if len(tokens) <= words:
        return page_text
    claim_terms = _terms(claim)
    numbers = {t for t in claim_terms if t.isdigit()}
    best, best_score = 0, -1.0
    for start in range(0, len(tokens) - words + 1, step):
        window = _terms(" ".join(tokens[start:start + words]))
        score = len(window & claim_terms) + len(window & numbers)  # numbers count double
        if score > best_score:
            best, best_score = start, score
    return " ".join(tokens[best:best + words])


def domain_of(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


# Social and user-generated sites: no editorial process, and often no readable
# text for an agent. They don't get a seat at the table.
LOW_VALUE_DOMAINS = (
    "facebook.com", "instagram.com", "pinterest.", "tiktok.com", "twitter.com", "x.com",
    "threads.net", "threads.com", "linkedin.com", "youtube.com", "quora.com",
)


def is_low_value(domain: str) -> bool:
    for d in LOW_VALUE_DOMAINS:
        if d.endswith("."):  # any TLD: pinterest.com, au.pinterest.com, pinterest.co.uk
            if domain.startswith(d) or "." + d in domain:
                return True
        elif domain == d or domain.endswith("." + d):
            return True
    return False


# Words that appear in almost any news text; they say nothing about relevance.
_GENERIC = set("""according latest official officially report reports reported reporting said says
new today year years exactly about around nearly million billion percent per first last more
most also however world""".split())


def is_relevant(claim: str, text: str) -> bool:
    """
    Does a search result share enough specific terms with the claim to be
    worth a seat? Needs 2 shared terms (1 for very short claims), ignoring
    generic news words, so a gas-price page can't join a debate about Everest.
    """
    key = _terms(claim) - _GENERIC
    need = 2 if len(key) >= 3 else 1
    return len(key & _terms(text)) >= need


def build_sources(
    claim: str,
    results: list[dict],
    page_text: dict[str, str],
    max_sources: int = 5,
    per_domain: int = 1,
) -> list[dict]:
    """
    Pick up to `max_sources` search results and build each agent's document:
    title, search snippet, and the most claim-relevant passage of the page.
    One seat per site by default, so agreement means independent sources
    agree; social and user-generated sites, and off-topic results, are skipped.
    """
    sources: list[dict] = []
    seen_urls: set[str] = set()
    per: dict[str, int] = {}
    for r in results:
        url = r.get("url", "")
        if not url or url in seen_urls:
            continue
        dom = domain_of(url)
        if is_low_value(dom) or per.get(dom, 0) >= per_domain:
            continue
        snippet = (r.get("snippet") or "").strip()
        passage = best_passage(page_text.get(url, ""), claim) if page_text.get(url) else ""
        if len(snippet) + len(passage) < 40:
            continue
        if not is_relevant(claim, " ".join((r.get("title", ""), snippet, passage))):
            continue
        seen_urls.add(url)
        per[dom] = per.get(dom, 0) + 1
        text = "\n".join(p for p in (r.get("title", "").strip(), snippet, passage) if p)
        sources.append({
            "agent": len(sources),
            "title": r.get("title", "") or dom,
            "url": url,
            "domain": dom,
            "text": text[:1600],
            "scraped": bool(passage),
        })
        if len(sources) >= max_sources:
            break
    return sources


def agent_document(source: dict) -> str:
    return f"(Source: {source['domain']})\n{source['text']}"


# ── Syndicated copies ────────────────────────────────────────────────────────

def _shingles(text: str, k: int = 5) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {" ".join(words[i:i + k]) for i in range(max(1, len(words) - k + 1))}


def merge_duplicate_sources(sources: list[dict], threshold: float = 0.5) -> list[dict]:
    """
    News spreads by syndication: one wire story shows up on many sites. Copies
    of the same report are not independent evidence, so they share one agent,
    which records where else the story ran ("also"). Two sources count as
    copies when at least `threshold` of the shorter one's 5-word shingles
    appear in the other.
    """
    merged: list[dict] = []
    for s in sources:
        sh = _shingles(s["text"])
        for m in merged:
            overlap = len(sh & m["_sh"]) / max(1, min(len(sh), len(m["_sh"])))
            if overlap >= threshold:
                m["also"].append({"domain": s["domain"], "url": s["url"]})
                break
        else:
            merged.append({**s, "also": [], "_sh": sh})
    out = []
    for i, m in enumerate(merged):
        m.pop("_sh")
        out.append({**m, "agent": i})
    return out


# ── Running it ───────────────────────────────────────────────────────────────

def verify_claim_by_debate(
    claim: str,
    sources: list[dict],
    llm_call: LLMCall,
    *,
    today: str,
    num_rounds: int,
    concurrency: int = 3,
) -> Iterator[dict]:
    """Debate events for one claim; the last event is debate_end with the record."""
    task = ClaimVerificationTask(claim, today)
    yield from run_debate(
        task,
        [agent_document(s) for s in sources],
        llm_call,
        num_rounds=num_rounds,
        concurrency=concurrency,
    )


# ── Grouped debate (default for news) ────────────────────────────────────────
#
# The paper's debate re-asks every agent every round. For news that is
# wasteful: after the first read, sources fall into a few positions, and most
# agree with each other. So after round 1 the agents are grouped by verdict:
# a Supports group and a Refutes group, with agents that found nothing set
# aside. If only one group exists there is nothing to argue and the aggregator
# rules straight away. Otherwise each group gets one advocate who sees its
# members' evidence and the other group's, and either holds the position or
# concedes; the aggregator then rules on the two cases. That is n + 3 calls
# per claim at most, instead of 2n + 2, and it fits a 4k-context model.

def _member_line(i: int, reply: AgentReply, sources: list[dict], width: int = 220) -> str:
    s = sources[i] if i < len(sources) else {}
    also = s.get("also") or []
    where = s.get("domain", f"source {i + 1}")
    if also:
        where += f"; the same report also ran on {', '.join(a['domain'] for a in also)}"
    fact = reply.answer if reply.answer and reply.answer != "unknown" else reply.explanation
    return f"- Agent {i + 1} ({where}): {fact[:width]}"


def _group_label(stance: str) -> str:
    return {"SUPPORTS": "supports", "REFUTES": "contradicts"}.get(stance, "says nothing about")


def advocate_prompt(task: "ClaimVerificationTask", camp: dict, other: dict,
                    replies: list[AgentReply], sources: list[dict]) -> str:
    mine = "\n".join(_member_line(i, replies[i], sources) for i in camp["members"])
    theirs = "\n".join(_member_line(i, replies[i], sources) for i in other["members"])
    return f"""You are the advocate for a group of {len(camp['members'])} web sources whose evidence {_group_label(camp['stance'])} the claim below ({camp['stance']}). Today's date is {task.today}.

Claim: {task.claim}

Your group's evidence:
{mine}

The opposing group ({other['stance']}) says:
{theirs}

Weigh both groups. They may describe different people, places, events or dates that share a name, one side may be outdated, or one side may be misinformation. Copies of the same report count as one source. Keep your group's verdict only if its evidence holds up against the other side; otherwise concede and give the verdict you now believe.
Please follow the format: 'Verdict: {{}}. Answer: {{}}. Explanation: {{}}.'"""


def group_aggregator_prompt(task: "ClaimVerificationTask", camps: list[dict], set_aside: list[int],
                            replies: list[AgentReply], camp_turns: list[dict],
                            sources: list[dict]) -> str:
    blocks = []
    for ci, camp in enumerate(camps):
        members = ", ".join(str(i + 1) for i in camp["members"])
        lines = "\n".join(_member_line(i, replies[i], sources, width=180) for i in camp["members"])
        block = f"Group {camp['stance']} (agents {members}):\n{lines}"
        turn = next((t for t in camp_turns if t["camp"] == ci), None)
        if turn:
            outcome = "conceded" if turn["conceded"] else "held its position"
            block += (f"\nAfter hearing the other group, its advocate {outcome}: "
                      f"Verdict: {turn['verdict']}. {turn['explanation'][:300]}")
        blocks.append(block)
    if set_aside:
        blocks.append("No information on the claim: agents " + ", ".join(str(i + 1) for i in set_aside))
    groups = "\n\n".join(blocks) if blocks else "No agent found anything about the claim."
    return f"""You are an aggregator reading a debate between groups of web sources about one claim. Each agent read a different source. Today's date is {task.today}.

Sources can conflict for different reasons, and each needs different handling:
- Ambiguity: sources describe different entities or events that share a name. Each can be right about its own subject; decide which one the claim is about.
- Misinformation or outdated reports: a source conflicts with better-supported evidence. Do not let it decide the verdict.
- Noise: a source does not address the claim. Ignore it.
Copies of the same report count as one source.

Claim: {task.claim}

{groups}

Decide whether the claim is supported, refuted, or cannot be decided from these sources, give a confidence between 0 and 1, and explain briefly.
Please follow the format exactly:
Verdict: <SUPPORTS | REFUTES | NOT_ENOUGH_INFO>
Confidence: <number between 0 and 1>
Reliable Agents: [<agents whose evidence you relied on>]
Unreliable Agents: [<agents whose claims look like misinformation or are outdated>]
Irrelevant Agents: [<agents whose documents do not address the claim>]
Ambiguity: <one sentence if sources describe different entities or events, otherwise none>
Explanation: <reasoning>

Now give your judgment for this claim only, starting with "Verdict:".
"""


def run_grouped_debate(
    claim: str,
    sources: list[dict],
    llm_call: LLMCall,
    *,
    today: str,
    concurrency: int = 3,
) -> Iterator[dict]:
    """
    Grouped MADAM-RAG debate for one claim. Emits the same event types as
    madam_rag.run_debate, plus:
      {"type": "camps", "round": 1, "camps": [{"stance", "members"}], "set_aside": [...]}
      {"type": "camp_thinking", "round": 2, "camp", "members"}
      {"type": "camp_response", "round": 2, "camp", "stance", "members", "verdict",
       "answer", "explanation", "conceded"}
    Round-2 agent_response events mirror each member's group position, so
    per-agent views stay consistent.
    """
    from madam_rag import _run_agents  # shared thread-pool runner

    task = ClaimVerificationTask(claim, today)
    n = len(sources)
    yield {"type": "debate_start", "num_agents": n, "max_rounds": 2, "mode": "grouped"}

    rounds: list[list[AgentReply]] = []
    camps: list[dict] = []
    set_aside: list[int] = []
    camp_turns: list[dict] = []
    final: Optional[Aggregation] = None

    if n:
        # Round 1: every source read on its own, exactly as in the paper
        yield {"type": "round_start", "round": 1}
        replies: list[Optional[AgentReply]] = [None] * n
        prompts = [task.agent_prompt(agent_document(s), "") for s in sources]
        for ev in _run_agents(prompts, llm_call, task.agent_max_tokens, concurrency):
            if ev[0] == "start":
                yield {"type": "agent_thinking", "round": 1, "agent": ev[1]}
                continue
            reply = task.parse_agent(ev[2], ev[1], 1)
            replies[ev[1]] = reply
            yield {"type": "agent_response", **reply.to_dict()}
        first: list[AgentReply] = replies  # type: ignore[assignment]
        rounds.append(first)

        for stance in ("SUPPORTS", "REFUTES"):
            members = [r.agent for r in first if r.verdict == stance]
            if members:
                camps.append({"stance": stance, "members": members})
        set_aside = [r.agent for r in first if r.verdict not in ("SUPPORTS", "REFUTES")]
        yield {"type": "camps", "round": 1, "camps": camps, "set_aside": set_aside}

        # Round 2: the two groups argue it out (only when there is a dispute)
        if len(camps) == 2:
            yield {"type": "round_start", "round": 2}
            prompts = [advocate_prompt(task, camps[0], camps[1], first, sources),
                       advocate_prompt(task, camps[1], camps[0], first, sources)]
            turns: list[Optional[dict]] = [None, None]
            for ev in _run_agents(prompts, llm_call, task.agent_max_tokens, concurrency):
                ci = ev[1]
                if ev[0] == "start":
                    yield {"type": "camp_thinking", "round": 2, "camp": ci, "members": camps[ci]["members"]}
                    continue
                said = task.parse_agent(ev[2], -1, 2)
                turn = {
                    "camp": ci, "stance": camps[ci]["stance"], "members": camps[ci]["members"],
                    "verdict": said.verdict, "answer": said.answer, "explanation": said.explanation,
                    "raw": ev[2], "conceded": said.verdict != camps[ci]["stance"],
                }
                turns[ci] = turn
                yield {"type": "camp_response", "round": 2, **turn}
            camp_turns = [t for t in turns if t]
            second = []
            for r in first:
                t = next((t for t in camp_turns if r.agent in t["members"]), None)
                reply = (AgentReply(agent=r.agent, round=2, raw=t["raw"], answer=t["answer"],
                                    explanation=t["explanation"], verdict=t["verdict"],
                                    changed=t["verdict"] != r.verdict)
                         if t else
                         AgentReply(agent=r.agent, round=2, raw=r.raw, answer=r.answer,
                                    explanation=r.explanation, verdict=r.verdict))
                second.append(reply)
                yield {"type": "agent_response", **reply.to_dict()}
            rounds.append(second)

        # Aggregation: always over the groups (the paper's aggregator, one call)
        r = len(rounds)
        yield {"type": "aggregator_thinking", "round": r}
        prompt = group_aggregator_prompt(task, camps, set_aside, first, camp_turns, sources)
        agg = task.parse_aggregation(llm_call(prompt, task.aggregator_max_tokens), r)
        problem = task.aggregation_problem(agg, n)
        if problem:
            print(f"      [WARN] Aggregator output rejected ({problem}); asking again")
            retry = task.parse_aggregation(
                llm_call(prompt + task.retry_suffix, task.aggregator_max_tokens), r)
            if not task.aggregation_problem(retry, n):
                agg = retry
            else:
                agg.extra["rejected"] = problem
        final = agg
        yield {"type": "aggregation", "round": r, "aggregation": agg.to_dict()}

    record = {
        "mode": "grouped",
        "num_agents": n,
        "max_rounds": 2,
        "rounds_used": len(rounds),
        "converged": False,
        "converged_round": None,
        "camps": camps,
        "set_aside": set_aside,
        "camp_turns": [{k: v for k, v in t.items() if k != "raw"} for t in camp_turns],
        "rounds": [[a.to_dict() for a in rnd] for rnd in rounds],
        "aggregations": [final.to_dict()] if final else [],
        "final": final.to_dict() if final else None,
    }
    yield {"type": "debate_end", "record": record}


def _majority_verdict(claim: str, record: dict, sources: list[dict], problem: str) -> dict:
    """Fallback when the aggregator's ruling is unusable: count the agents' last answers."""
    last = record["rounds"][-1] if record.get("rounds") else []
    votes = [t["verdict"] for t in last if t.get("verdict") in ("SUPPORTS", "REFUTES")]
    sup, ref = votes.count("SUPPORTS"), votes.count("REFUTES")
    verdict = "SUPPORTS" if sup > ref else "REFUTES" if ref > sup else "NOT_ENOUGH_INFO"
    share = max(sup, ref) / len(last) if last and sup != ref else 0.0
    return {
        "claim": claim,
        "verdict": verdict,
        "confidence": round(0.5 * share, 3),  # halved: no aggregator vetted these votes
        "justification": (
            f"The aggregator's ruling couldn't be used ({problem}), so this verdict is a "
            f"plain majority of the agents' final answers: {sup} support, {ref} refute, "
            f"{len(last) - sup - ref} found nothing.\nSources: "
            + " ".join(s["url"] for s in sources)
        ),
    }


def verdict_from_record(claim: str, record: dict, sources: list[dict]) -> dict:
    """Collapse a finished debate into the pipeline's per-claim verdict."""
    final: Optional[dict] = record.get("final")
    if not final:
        return {
            "claim": claim,
            "verdict": "NOT_ENOUGH_INFO",
            "confidence": 0.0,
            "justification": "No usable sources were found for this claim, so no debate was held.",
        }
    if final.get("rejected"):
        return _majority_verdict(claim, record, sources, final["rejected"])
    cited = [sources[i]["url"] for i in final.get("reliable_agents", []) if 0 <= i < len(sources)]
    flagged = [sources[i]["domain"] for i in final.get("unreliable_agents", []) if 0 <= i < len(sources)]
    parts = [final.get("explanation", "").strip()]
    if final.get("ambiguity"):
        parts.append(f"Ambiguity: {final['ambiguity']}")
    if flagged:
        parts.append("Flagged as unreliable: " + ", ".join(flagged) + ".")
    if cited:
        parts.append("Sources: " + " ".join(cited))
    return {
        "claim": claim,
        "verdict": final.get("verdict", "NOT_ENOUGH_INFO"),
        "confidence": final.get("confidence", 0.5),
        "justification": "\n".join(p for p in parts if p),
    }
