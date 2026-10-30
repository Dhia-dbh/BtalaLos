# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS node-runtime

FROM debian:trixie-slim
# Add template-specific packages explicitly at build time.
ARG TEXLIVE_EXTRA_PACKAGES=""
RUN printf '%s\n' \
      'path-exclude=/usr/share/man/*' \
      'path-exclude=/usr/share/doc/*' \
      'path-include=/usr/share/doc/*/copyright' \
      'path-exclude=/usr/share/texlive/texmf-dist/doc/*' \
      > /etc/dpkg/dpkg.cfg.d/01-no-manuals \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates libatomic1 libstdc++6 git latexmk \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra \
      texlive-fonts-recommended texlive-xetex texlive-luatex $TEXLIVE_EXTRA_PACKAGES \
      poppler-utils python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY scripts/application-worker/requirements.txt /opt/worker/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --only-binary=:all: -r /opt/worker/requirements.txt \
    && /opt/venv/bin/pip uninstall -y pip
WORKDIR /opt/worker
COPY scripts/application-worker.mjs scripts/codex-bridge.mjs ./scripts/
COPY scripts/application-worker/*.mjs scripts/application-worker/merge_pdfs.py ./scripts/application-worker/
COPY LICENSE NOTICE.md ./
ENV NODE_ENV=production \
    HOME=/tmp/btalalos-worker \
    DOSSIER_WORKER_CONTAINER=1 \
    DOSSIER_WORKER_BIND=0.0.0.0 \
    DOSSIER_PYTHON_BIN=/opt/venv/bin/python \
    PYTHONDONTWRITEBYTECODE=1
USER 1000:1000
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.DOSSIER_WORKER_PORT || 8788) + '/health', {headers: {authorization: 'Bearer ' + process.env.DOSSIER_WORKER_TOKEN}, signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "scripts/application-worker.mjs"]
