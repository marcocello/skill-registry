FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY backend ./backend

RUN python -m pip install --no-cache-dir .

EXPOSE 8000

CMD ["sh", "-c", "exec gunicorn --bind \"${HOST}:${PORT}\" --workers 1 --threads 4 --access-logfile - --access-logformat '%(h)s %(m)s %(U)s %(s)s' --error-logfile - 'backend.app.main:create_app()'"]
