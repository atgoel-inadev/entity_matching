"""
ResolveIQ — Generic Entity Resolution Engine
Powered by Snowflake Cortex

Endpoints:
  Profiles:    GET/POST /profiles, GET/PUT/DELETE /profiles/{slug}
  Resolution:  POST /profiles/{slug}/resolve, /resolve/batch
  Entities:    POST/GET /profiles/{slug}/entities
  Legacy:      POST /match, /match/batch, GET /health, /stats
"""

import os
import time
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

import setuptools
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .services.snowflake import get_snowpark_session, close_session
from .services.cache import get_redis
from .routers import profiles, resolve, legacy

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("resolveiq")

# ---------------------------------------------------------------------------
# Lifespan: startup / shutdown
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warm connections
    get_snowpark_session()
    get_redis()
    logger.info("ResolveIQ started.")
    yield
    # Shutdown
    close_session()
    logger.info("ResolveIQ stopped.")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ResolveIQ",
    description="Generic entity resolution engine with configurable profiles, "
                "multi-field matching (EXACT, FUZZY, SEMANTIC, PHONETIC, NUMERIC), "
                "and sub-100ms latency. Powered by Snowflake Cortex.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS (allow React dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(profiles.router)   # /profiles/*
app.include_router(resolve.router)    # /profiles/{slug}/resolve, /entities, /stats
app.include_router(legacy.router)     # /match, /health, /stats, /cache

# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    logger.info(f"{request.method} {request.url.path} - {response.status_code} - {elapsed:.1f}ms")
    return response

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("api.app:app", host="0.0.0.0", port=port, reload=False, workers=1)
