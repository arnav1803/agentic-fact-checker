"""
prompts.py — Load / save / manage prompts in MongoDB

Prompts are stored in the 'prompts' collection so they can be
edited without code changes. Each prompt has a name, version,
and an is_active flag. Fetch by name or by MongoDB _id.
"""

from datetime import datetime, timezone
from bson import ObjectId
from db import prompts_col
from models import PromptDoc


def get_prompt_by_id(prompt_id: str) -> dict:
    """Fetch a prompt document by its MongoDB _id."""
    doc = prompts_col().find_one({"_id": ObjectId(prompt_id)})
    if not doc:
        raise ValueError(f"No prompt found with _id='{prompt_id}'.")
    doc["_id"] = str(doc["_id"])
    return doc


def get_active_prompt(name: str) -> str:
    """Fetch the active prompt template by name. Raises if not found."""
    doc = prompts_col().find_one({"name": name, "is_active": True})
    if not doc:
        raise ValueError(
            f"No active prompt found with name='{name}'. "
            f"Run `python seed_prompts.py` to populate defaults."
        )
    return doc["template"]


def upsert_prompt(prompt: PromptDoc) -> None:
    """Insert or update a prompt (matched by name + version)."""
    data = prompt.dict()
    data["updated_at"] = datetime.now(timezone.utc)
    prompts_col().update_one(
        {"name": prompt.name, "version": prompt.version},
        {"$set": data},
        upsert=True,
    )


def deactivate_prompt(name: str, version: int) -> None:
    """Deactivate a specific prompt version."""
    prompts_col().update_one(
        {"name": name, "version": version},
        {"$set": {"is_active": False, "updated_at": datetime.now(timezone.utc)}},
    )


def list_prompts() -> list[dict]:
    """List all prompts (for debugging)."""
    return list(prompts_col().find({}, {"_id": 0}))
