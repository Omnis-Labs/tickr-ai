"""OpenTelemetry setup — opt-in via `OTEL_ENABLED=true`.

When enabled and `OTEL_EXPORTER_OTLP_ENDPOINT` points at a real collector
(Honeycomb / Grafana Tempo / Jaeger / etc), spans ship there over OTLP/gRPC.
When enabled with no endpoint, spans print to stderr — useful for local smoke
testing without standing up a backend.

When disabled (the default), this module is a no-op and FastAPI/HTTPX calls
have no instrumentation overhead.

Spans we care about:
  * one root span per /task1/jobs POST or /task2/extractions POST
  * one child span per LLM call (added in shared.llm_gateway when OTel is on)
  * one child span per Playwright action (added in task1 executor when on)
"""

from __future__ import annotations

from shared.config import get_settings
from shared.logging import get_logger

logger = get_logger(__name__)

_initialised = False


def setup_otel(app=None) -> bool:
    """Initialise OpenTelemetry if `OTEL_ENABLED=true`. Idempotent.

    Returns True if instrumentation was wired, False if disabled / failed
    (failures are logged but never raise — observability must never break
    the request path).
    """
    global _initialised
    if _initialised:
        return True
    settings = get_settings()
    if not settings.otel_enabled:
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
        )

        resource = Resource.create(
            {
                "service.name": "whaleforce-llm-test",
                "service.version": "0.2.0",
                "deployment.environment": "dev" if settings.log_format == "text" else "prod",
            }
        )
        provider = TracerProvider(resource=resource)

        endpoint = settings.otel_exporter_otlp_endpoint.strip()
        if endpoint and endpoint != "http://localhost:4317":
            # Real OTLP target — try to ship there
            try:
                from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                    OTLPSpanExporter,
                )
                exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
                provider.add_span_processor(BatchSpanProcessor(exporter))
                logger.info("otel_exporter_chosen", kind="otlp_grpc", endpoint=endpoint)
            except ImportError:
                logger.warning(
                    "otel_otlp_exporter_missing",
                    hint="install opentelemetry-exporter-otlp-proto-grpc",
                )
                provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        else:
            # Smoke-test mode — dump spans to stderr
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
            logger.info("otel_exporter_chosen", kind="console")

        trace.set_tracer_provider(provider)

        if app is not None:
            try:
                from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

                FastAPIInstrumentor.instrument_app(app)
                logger.info("otel_fastapi_instrumented")
            except Exception as e:  # noqa: BLE001
                logger.warning("otel_fastapi_instrument_failed", error=str(e))

        _initialised = True
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("otel_setup_failed", error=str(e))
        return False


def get_tracer(name: str = "whaleforce"):
    """Return a no-op tracer when OTel is disabled — callers don't branch."""
    try:
        from opentelemetry import trace
        return trace.get_tracer(name)
    except Exception:  # noqa: BLE001
        class _NoopTracer:
            def start_as_current_span(self, *args, **kwargs):
                from contextlib import contextmanager

                @contextmanager
                def _noop():
                    yield None

                return _noop()

        return _NoopTracer()
