"""Executor — wraps Playwright with the three-pronged locator probe.

Responsibilities:
  * Domain allow-list enforcement on every navigation (security)
  * Locator probing: try primary CSS → semantic role+name → visual text
  * Action execution (navigate, click, type, select, scroll, wait, extract)
  * DOM snapshot + screenshot capture into the artifact store
  * Visible text + a11y tree extraction for verifier / diagnoser
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from playwright.async_api import (
    Browser,
    BrowserContext,
    ElementHandle,
    Page,
    Playwright,
    async_playwright,
)

from shared.artifacts import put_artifact
from shared.config import get_settings
from shared.logging import get_logger
from shared.schemas import ActionType, ArtifactRef, FailureKind, Locator, PlannedStep

logger = get_logger(__name__)


class NavigationBlockedError(RuntimeError):
    """Raised when a step tries to navigate outside the domain allow-list."""


class LocatorNotFoundError(RuntimeError):
    """All three locator prongs failed to find an element."""


@dataclass
class PageSnapshot:
    url: str
    visible_text: str
    a11y_tree: str
    dom_excerpt: str
    screenshot_ref: ArtifactRef | None
    dom_snapshot_ref: ArtifactRef | None


class BrowserExecutor:
    """One executor instance = one isolated browser context. Single task lifecycle."""

    def __init__(self, *, job_id: str) -> None:
        self._settings = get_settings()
        self.job_id = job_id
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    async def __aenter__(self) -> BrowserExecutor:
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=self._settings.playwright_headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            ),
        )
        self._context.set_default_timeout(self._settings.browser_timeout_ms)
        self._page = await self._context.new_page()
        return self

    async def __aexit__(self, *exc: object) -> None:
        try:
            if self._context:
                await self._context.close()
            if self._browser:
                await self._browser.close()
        finally:
            if self._pw:
                await self._pw.stop()

    # ------------------------------------------------------------------ helpers

    @property
    def page(self) -> Page:
        assert self._page is not None, "Executor must be used inside async with"
        return self._page

    def _check_domain(self, url: str) -> None:
        allowed = self._settings.allowed_domains
        if not allowed:
            return  # explicitly disabled
        host = urlparse(url).hostname or ""
        host = host.lower()
        for domain in allowed:
            d = domain.lower().lstrip(".")
            if host == d or host.endswith("." + d):
                return
        raise NavigationBlockedError(
            f"Domain '{host}' not in allow-list ({', '.join(allowed)})"
        )

    async def snapshot(self, *, step_index: int) -> PageSnapshot:
        url = self.page.url
        # Visible text + current form state. innerText alone does NOT include
        # input/textarea values, so the verifier cannot see what we just typed.
        # We append a "[FORM STATE]" block listing every visible input's value
        # so verifier prompts can check "the search box contains X".
        # FORM STATE goes FIRST so the verifier (which truncates to 1500 chars)
        # always sees post-action input values regardless of body length.
        visible_text = await self.page.evaluate(
            """() => {
                const formNodes = Array.from(document.querySelectorAll('input, textarea, select'));
                const lines = [];
                for (const el of formNodes) {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    if (el.type === 'hidden') continue;
                    const name = el.getAttribute('name') || el.getAttribute('id') ||
                                 el.getAttribute('aria-label') || el.getAttribute('placeholder') || '?';
                    const val = (el.value ?? '').toString().slice(0, 120);
                    if (val === '' || val === 'on' || val === 'off') continue;
                    lines.push(`  ${el.tagName.toLowerCase()}[${name}] = ${JSON.stringify(val)}`);
                    if (lines.length >= 20) break;
                }
                const formBlock = lines.length ? '[FORM STATE]\\n' + lines.join('\\n') + '\\n\\n[PAGE TEXT]\\n' : '';
                const body = document.body ? document.body.innerText.slice(0, 6500) : '';
                return formBlock + body;
            }"""
        )
        # Synthesised a11y description — Playwright 1.50+ removed
        # page.accessibility, so we walk interactive nodes ourselves and emit
        # role + accessible-name lines that the locator LLM can reason over.
        a11y_tree = await self.page.evaluate(_A11Y_JS) or ""
        # DOM excerpt — covers BOTH interactive (for click/type/select) AND
        # content (for extract) elements. The locator LLM picks selectors from
        # whatever appears here, so omissions == invisible-to-locator.
        dom_excerpt = await self.page.evaluate(
            """() => {
                const keep = ['id','class','name','role','aria-label','placeholder','href','type','data-testid'];
                const fmt = (n, textLen) => {
                    const attrs = Array.from(n.attributes)
                        .filter(a => keep.includes(a.name))
                        .map(a => `${a.name}="${a.value.slice(0,50)}"`)
                        .join(' ');
                    const text = (n.innerText || '').slice(0, textLen).replace(/\\s+/g,' ').trim();
                    return `<${n.tagName.toLowerCase()} ${attrs}>${text}</${n.tagName.toLowerCase()}>`;
                };
                const interactive = Array.from(document.querySelectorAll(
                    'input, button, a, select, textarea, form, label, nav, main, [role]'
                )).slice(0, 60).map(n => fmt(n, 60));
                // Content elements — Wikipedia / generic site mains first
                // (the dominant interview-set pattern); bare HTML pages as
                // last-resort fallback only when the primary set is empty.
                let content = Array.from(document.querySelectorAll(
                    'article, main p, [role=main] p, #content p, #bodyContent p, .mw-parser-output > p, h1, h2, h3'
                )).slice(0, 25).map(n => fmt(n, 140));
                if (content.length < 3) {
                    // Bare HTML page (e.g. httpbin) — fall back to body
                    // paragraphs. We do NOT add this to the primary set
                    // because on Wikipedia / arXiv it adds noise.
                    content = Array.from(document.querySelectorAll('body p'))
                        .slice(0, 15).map(n => fmt(n, 160));
                }
                const out = [];
                if (interactive.length) out.push('# Interactive elements\\n' + interactive.join('\\n'));
                if (content.length) out.push('# Content elements\\n' + content.join('\\n'));
                return out.join('\\n\\n');
            }"""
        )

        screenshot_bytes = await self.page.screenshot(full_page=False)
        dom_bytes = (await self.page.content()).encode("utf-8")

        screenshot_ref = await put_artifact(
            f"{self.job_id}/step-{step_index}-screenshot.png",
            screenshot_bytes,
            "image/png",
        )
        dom_ref = await put_artifact(
            f"{self.job_id}/step-{step_index}-dom.html",
            dom_bytes,
            "text/html",
        )

        return PageSnapshot(
            url=url,
            visible_text=visible_text or "",
            a11y_tree=a11y_tree,
            dom_excerpt=dom_excerpt or "",
            screenshot_ref=screenshot_ref,
            dom_snapshot_ref=dom_ref,
        )

    async def _probe_locator(self, loc: Locator) -> ElementHandle:
        """Try each prong in order; return first matching element handle."""
        # 1) primary (CSS / XPath)
        if loc.primary:
            try:
                if loc.primary.startswith("//") or loc.primary.startswith("(//"):
                    el = await self.page.wait_for_selector(
                        f"xpath={loc.primary}", state="visible", timeout=4000
                    )
                else:
                    el = await self.page.wait_for_selector(
                        loc.primary, state="visible", timeout=4000
                    )
                if el:
                    return el
            except Exception as e:  # noqa: BLE001
                logger.info("locator_primary_failed", selector=loc.primary, error=str(e))

        # 2) semantic — Playwright's role-based locator
        if loc.semantic_role:
            try:
                role_loc = self.page.get_by_role(
                    loc.semantic_role,  # type: ignore[arg-type]
                    name=re.compile(re.escape(loc.semantic_name), re.I) if loc.semantic_name else None,
                ).first
                await role_loc.wait_for(state="visible", timeout=3000)
                el = await role_loc.element_handle()
                if el:
                    return el
            except Exception as e:  # noqa: BLE001
                logger.info("locator_semantic_failed", role=loc.semantic_role, error=str(e))

        # 3) visual — by visible text
        if loc.visual_text:
            try:
                text_loc = self.page.get_by_text(loc.visual_text, exact=False).first
                await text_loc.wait_for(state="visible", timeout=3000)
                el = await text_loc.element_handle()
                if el:
                    return el
            except Exception as e:  # noqa: BLE001
                logger.info("locator_visual_failed", text=loc.visual_text, error=str(e))

        raise LocatorNotFoundError(
            f"No prong matched: primary={loc.primary!r}, "
            f"semantic={loc.semantic_role!r}/{loc.semantic_name!r}, visual={loc.visual_text!r}"
        )

    # ------------------------------------------------------------------ actions

    async def execute(
        self, step: PlannedStep
    ) -> tuple[FailureKind | None, str | None, dict[str, Any]]:
        """Run one step. Returns (failure_kind, error_message, output)."""
        try:
            if step.action == ActionType.NAVIGATE:
                if not step.value:
                    return FailureKind.UNKNOWN, "navigate step missing URL", {}
                self._check_domain(step.value)
                await self.page.goto(step.value, wait_until="domcontentloaded")
                return None, None, {"url": self.page.url}

            if step.action == ActionType.WAIT:
                # Wait for network-idle or a hint in `value` (a selector to wait for)
                if step.value:
                    await self.page.wait_for_selector(step.value, state="visible")
                else:
                    await self.page.wait_for_load_state("networkidle")
                return None, None, {}

            if step.action == ActionType.SCROLL:
                await self.page.evaluate("window.scrollBy(0, window.innerHeight)")
                return None, None, {}

            # Actions that need a locator
            if step.locator is None:
                return FailureKind.STALE_SELECTOR, "no locator resolved", {}
            try:
                el = await self._probe_locator(step.locator)
            except LocatorNotFoundError:
                # Structural last-resort for EXTRACT: when all three prongs
                # fail and we don't know the exact visible text in advance,
                # fall back to the first paragraph in the most likely
                # content region. The verifier will reject if it's the wrong
                # paragraph — but it usually isn't, because real articles
                # surface their first paragraph in one of these regions.
                if step.action == ActionType.EXTRACT:
                    fallback = self.page.locator(
                        ", ".join([
                            ".mw-parser-output > p:not(.mw-empty-elt)",
                            "article p", "main p", "[role=main] p",
                            "#content p", "#bodyContent p", "body p",
                        ])
                    ).first
                    try:
                        await fallback.wait_for(state="visible", timeout=3000)
                        el = await fallback.element_handle()
                        if el is None:
                            raise LocatorNotFoundError("structural extract fallback found nothing")
                        logger.info("extract_structural_fallback_used")
                    except Exception as e:  # noqa: BLE001
                        raise LocatorNotFoundError(
                            f"all prongs + structural extract fallback failed: {e}"
                        ) from e
                else:
                    raise

            if step.action == ActionType.CLICK:
                await el.click()
                return None, None, {}
            if step.action == ActionType.TYPE:
                await el.fill(step.value or "")
                return None, None, {}
            if step.action == ActionType.SELECT:
                await el.select_option(step.value or "")
                return None, None, {}
            if step.action == ActionType.EXTRACT:
                text = await el.inner_text()
                return None, None, {"extracted_text": text.strip()}

            return FailureKind.UNKNOWN, f"unsupported action {step.action}", {}

        except NavigationBlockedError as e:
            return FailureKind.NAVIGATION_BLOCKED, str(e), {}
        except LocatorNotFoundError as e:
            return FailureKind.STALE_SELECTOR, str(e), {}
        except Exception as e:  # noqa: BLE001
            logger.warning("execute_unhandled", action=step.action.value, error=str(e))
            return FailureKind.UNKNOWN, str(e), {}


# JS that synthesises an a11y-tree-like flat description.
# Returns one "- role: \"name\"" line per interactive/landmark element,
# capped at 150 entries. Used by the locator prompt.
_A11Y_JS = r"""
() => {
    const tagRole = {
        a: 'link', button: 'button', select: 'combobox', textarea: 'textbox',
        nav: 'navigation', main: 'main', form: 'form', label: 'label',
        h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading'
    };
    const inputRole = {
        submit: 'button', button: 'button', search: 'searchbox',
        checkbox: 'checkbox', radio: 'radio', email: 'textbox',
        password: 'textbox', text: 'textbox', url: 'textbox',
        tel: 'textbox', number: 'spinbutton'
    };
    const nodes = Array.from(document.querySelectorAll(
        'a, button, input, select, textarea, [role], nav, main, form, label, h1, h2, h3, h4'
    ));
    const out = [];
    for (const el of nodes) {
        if (out.length >= 150) break;
        let role = el.getAttribute('role') || tagRole[el.tagName.toLowerCase()];
        if (!role && el.tagName === 'INPUT') {
            role = inputRole[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
        }
        if (!role) continue;
        let name = el.getAttribute('aria-label') || '';
        if (!name && el.id) {
            const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
            if (lbl) name = lbl.innerText || '';
        }
        if (!name) name = el.getAttribute('placeholder') || '';
        if (!name) name = el.getAttribute('name') || '';
        if (!name) name = (el.innerText || el.value || '').slice(0, 80);
        name = name.replace(/\s+/g, ' ').trim().slice(0, 80);
        out.push(`- ${role}: "${name}"`);
    }
    return out.join('\n');
}
"""
