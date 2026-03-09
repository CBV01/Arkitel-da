# Build stage for frontend
FROM node:18-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
# Build the static frontend
RUN npm run build

# Final stage
FROM python:3.9-slim
RUN useradd -m -u 1000 user
WORKDIR /app

# Copy frontend build output to a place where backend can find it
# FastAPI will serve this from frontend/out
COPY --from=frontend-builder /app/frontend/out ./frontend/out

# Install backend dependencies
COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the entire backend folder content to the container root /app
COPY backend/ .

# Permissions
RUN chown -R user:user /app
USER user

# Hugging Face requires port 7860
ENV PORT=7860
EXPOSE 7860

# Run with proxy headers support for Hugging Face
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
