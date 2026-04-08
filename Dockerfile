FROM python:3.11-slim

LABEL maintainer="ESXi VM Manager"
LABEL description="ESXi VM Manager Web Interface"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

RUN mkdir -p /app/logs && chmod 755 /app/logs

EXPOSE 5000

VOLUME ["/app/config", "/app/logs"]

ENTRYPOINT ["python"]
CMD ["-m", "app"]
