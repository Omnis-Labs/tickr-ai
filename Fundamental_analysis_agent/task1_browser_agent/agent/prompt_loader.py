"""Load prompt templates from disk. One-time read on first access."""

from functools import lru_cache
from pathlib import Path

PROMPTS_ROOT = Path(__file__).resolve().parents[2] / "prompts" / "task1_browser"


@lru_cache(maxsize=16)
def load(name: str) -> str:
    path = PROMPTS_ROOT / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {path}")
    text = path.read_text(encoding="utf-8")
    # Split on "## System" and "## User template" sections — return only the
    # rendered portion (everything after `## User template`). The system prompt
    # lives above `## User template` in the same file.
    return text


@lru_cache(maxsize=16)
def split(name: str) -> tuple[str, str]:
    """Return (system_prompt, user_template) parsed out of the prompt file."""
    text = load(name)
    sys_marker = "## System"
    user_marker = "## User template"
    if sys_marker not in text or user_marker not in text:
        raise ValueError(f"Prompt {name}.md missing System/User sections")
    sys_part = text.split(sys_marker, 1)[1].split(user_marker, 1)[0].strip()
    user_part = text.split(user_marker, 1)[1].strip()
    return sys_part, user_part


def render(template: str, **kwargs: object) -> str:
    """Tiny mustache-style replacement: {{key}} → value. No logic, no escaping."""
    out = template
    for k, v in kwargs.items():
        out = out.replace(f"{{{{{k}}}}}", str(v))
    return out
