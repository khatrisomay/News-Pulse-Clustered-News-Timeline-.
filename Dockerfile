FROM node:20-slim

# Install Python 3, pip, venv, and build-essential for building python dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy scraper requirements first to leverage Docker cache
COPY scraper/requirements.txt ./scraper/

# Create python virtual environment and install requirements
RUN python3 -m venv /app/scraper/venv && \
    /app/scraper/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /app/scraper/venv/bin/pip install --no-cache-dir -r scraper/requirements.txt

# Copy backend package dependencies
COPY backend/package*.json ./backend/

# Install Node dependencies
RUN cd backend && npm ci --only=production

# Copy application source code
COPY scraper/ ./scraper/
COPY backend/ ./backend/

# Set working directory to backend
WORKDIR /app/backend

# Expose backend port
EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production

# Command to start Express backend
CMD ["node", "server.js"]
