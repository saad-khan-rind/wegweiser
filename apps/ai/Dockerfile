FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-optional.txt ./
# Core deps must succeed; optional deps are best-effort (Pinecone, PDF, web).
RUN pip install --no-cache-dir -r requirements.txt \
 && (pip install --no-cache-dir -r requirements-optional.txt || echo "optional deps skipped")
COPY . .
EXPOSE 3002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3002"]
