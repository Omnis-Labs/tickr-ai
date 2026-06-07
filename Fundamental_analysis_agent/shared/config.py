from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centralised typed config. Read once at startup from environment / .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    llm_backend: Literal["anthropic", "openai", "gemini", "mock"] = "anthropic"

    anthropic_api_key: str = ""
    anthropic_model_cheap: str = "claude-haiku-4-5-20251001"
    anthropic_model_default: str = "claude-sonnet-4-6"
    anthropic_model_premium: str = "claude-opus-4-7"

    openai_api_key: str = ""
    openai_model_cheap: str = "gpt-4o-mini"
    openai_model_default: str = "gpt-4o"
    openai_model_premium: str = "o1"

    gemini_api_key: str = ""
    gemini_model_cheap: str = "gemini-2.5-flash-lite"
    gemini_model_default: str = "gemini-2.5-flash"
    gemini_model_premium: str = "gemini-2.5-pro"

    task1_budget_usd: float = 0.20
    task2_budget_usd: float = 0.10
    global_daily_budget_usd: float = 10.0

    # Price data source. yfinance is free but personal-use-only (ToS) and
    # rate-limits; "tiingo" is a licensed feed for a real product. Selection is
    # behind fetch_prices(); an unset/failed paid provider falls back to yfinance.
    price_provider: Literal["yfinance", "tiingo"] = "yfinance"
    tiingo_api_key: str = ""

    database_url: str = "sqlite+aiosqlite:///./data/dev.db"

    artifact_backend: Literal["local", "supabase"] = "local"
    artifact_dir: str = "./data/artifacts"
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_storage_bucket: str = "artifacts"

    playwright_headless: bool = True
    browser_timeout_ms: int = 30000
    task1_max_recovery_attempts: int = 3
    task1_max_steps: int = 20
    browser_domain_allowlist: str = Field(
        default="wikipedia.org,arxiv.org,news.ycombinator.com,httpbin.org",
        description="Comma-separated list of allowed domains for navigation.",
    )

    log_level: str = "INFO"
    log_format: Literal["json", "text"] = "json"
    otel_enabled: bool = False
    otel_exporter_otlp_endpoint: str = "http://localhost:4317"

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:3000"

    @property
    def allowed_domains(self) -> list[str]:
        return [d.strip() for d in self.browser_domain_allowlist.split(",") if d.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
