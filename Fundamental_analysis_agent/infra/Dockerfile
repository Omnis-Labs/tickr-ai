# Backend image: FastAPI + Playwright (Chromium).
# Used by Railway / Fly / Render / Zeabur — anywhere that supports a long-running
# container. Vercel cannot run this (it has no Playwright runtime).

# Tried Microsoft's Playwright Python image (mcr.microsoft.com/playwright/python:
# v1.48.0-jammy → Python 3.10 too old; v1.48.0-noble → tag may not exist for
# v1.48). Switched to upstream python:3.12-slim which is guaranteed to exist
# and matches our >=3.11 pyproject requirement. Playwright installs its own
# Chromium + OS deps via `--with-deps`.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Copy project manifest AND the package directories together. Hatchling's
# editable install (`pip install -e .`) needs the packages declared in
# [tool.hatch.build.targets.wheel].packages to exist at install time.
COPY pyproject.toml ./
COPY shared/ shared/
COPY task1_browser_agent/ task1_browser_agent/
COPY task2_10k_extractor/ task2_10k_extractor/
COPY task3_strategy/ task3_strategy/
COPY task4_technical/ task4_technical/
COPY task5_ensemble/ task5_ensemble/
COPY task6_insider/ task6_insider/
COPY prompts/ prompts/

RUN pip install --upgrade pip && pip install -e .

# Playwright's `--with-deps` runs apt-get install for every shared library
# the headless Chromium needs (libnss3, libcups2, libxkbcommon0, etc.).
# Adds ~250 MB to the image (Chromium binary + deps) and ~90 s to the
# build. Worth it: avoids guessing the apt list ourselves.
RUN playwright install --with-deps chromium

EXPOSE 8000
# Railway injects PORT dynamically — shell form so the variable expands.
CMD uvicorn task1_browser_agent.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
