"""Configure DeepEval to use **Groq** as the judge LLM, so the evals need no
OpenAI key. Import from here in the judge eval scripts."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import GROQ_MODEL
from langchain_groq import ChatGroq


def groq_chat(temperature: float = 0.0):
    return ChatGroq(model=GROQ_MODEL, temperature=temperature)


def _extract_json(text: str) -> str:
    text = re.sub(r"```(?:json)?", "", text).strip()
    m = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    return m.group(0) if m else text


# ── DeepEval judge (custom model wrapping Groq) ──────────────────────────────
def deepeval_groq_model():
    from deepeval.models import DeepEvalBaseLLM

    class GroqEvalModel(DeepEvalBaseLLM):
        def __init__(self):
            self.model = groq_chat()

        def load_model(self):
            return self.model

        def generate(self, prompt: str, schema=None):
            raw = self.model.invoke(prompt).content
            if schema is None:
                return raw
            # Newer DeepEval passes a pydantic schema and expects an instance
            try:
                return schema.model_validate_json(_extract_json(raw))
            except Exception:
                return schema(**json.loads(_extract_json(raw)))

        async def a_generate(self, prompt: str, schema=None):
            return self.generate(prompt, schema)

        def get_model_name(self):
            return f"groq:{GROQ_MODEL}"

    return GroqEvalModel()
