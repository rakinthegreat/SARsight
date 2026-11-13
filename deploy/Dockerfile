# SARsight backend image. The code comes from GitHub at build time, so rebuilding picks up the latest main
# (deploy/server/compose.yml: docker compose build --no-cache backend). Listens on 7860.
# Env: EARTHDATA_USERNAME, EARTHDATA_PASSWORD (secrets), SARSIGHT_CUSTOM_NISAR=1.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git nodejs && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1

ARG REPO=https://github.com/rakinthegreat/SARsight.git
ARG REF=main
RUN git clone --depth 1 --branch $REF $REPO /home/user/app && mkdir -p /home/user/app/data/custom
WORKDIR /home/user/app
RUN pip install --no-cache-dir --user -r backend/requirements.txt

WORKDIR /home/user/app/backend
EXPOSE 7860
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
