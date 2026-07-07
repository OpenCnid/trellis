# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS node-build
WORKDIR /app
COPY package.json package-lock.json tsconfig.build.json ./
# The build only needs tsc. Skipping lifecycle scripts avoids the unused
# redis-memory-server PoC dependency compiling a Redis binary in this stage.
RUN npm ci --ignore-scripts
COPY src ./src
COPY scripts/start_all.ts scripts/start_workers.ts scripts/scale_provenance_drill.ts scripts/test_compose_roundtrip.ts scripts/ingest_repository.ts ./scripts/
RUN npm run build

FROM node:22-bookworm-slim AS node-production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHON_EXECUTABLE=python3
WORKDIR /app

# PDF fast mode uses the reviewed Python imports plus these runtime tools.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        libglib2.0-0 \
        libmagic1 \
        libpq5 \
        poppler-utils \
        tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-pdf-fast.txt requirements-pdf-fast-nodeps.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir \
        --requirement requirements.txt \
        --requirement requirements-pdf-fast.txt \
    && /opt/venv/bin/pip install --no-cache-dir --no-deps \
        --requirement requirements-pdf-fast-nodeps.txt

COPY --from=node-production /app/node_modules ./node_modules
COPY --from=node-build /app/dist ./dist
COPY package.json package-lock.json ./
COPY src/rlm/trellis_agent.py src/rlm/trellis_tools.py src/rlm/trellis_mcp.py src/rlm/trec_rubric.json ./src/rlm/
# verification.ts resolves the rubric relative to __dirname, which is
# dist/src/core/graph in the compiled runtime — the same versioned file
# must exist at both the Python (src/rlm) and compiled-Node (dist/src/rlm)
# paths or the worker process crashes at import.
COPY src/rlm/trec_rubric.json ./dist/src/rlm/
COPY scripts/parse_pdf.py scripts/parse_python_source.py scripts/check_python_runtime.py \
     scripts/fixture_mcp_server.py scripts/compose_mcp_probe.py ./scripts/
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN mkdir -p uploads \
    && chown -R node:node /app \
    && chmod 0755 /app/scripts/docker-entrypoint.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/src/api/server.js"]
