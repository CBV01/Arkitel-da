FROM python:3.9-slim

# Create a non-root user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

# Copy only the backend requirements first for caching
COPY --chown=user backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the entire backend folder content to the container root /app
COPY --chown=user backend/ .

# Hugging Face requires port 7860
ENV PORT=7860
EXPOSE 7860

# Run the app. 
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
