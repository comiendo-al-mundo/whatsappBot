# Base image
FROM node:20-bullseye-slim

# Install dependencies for puppeteer (Chromium)
RUN apt-get update && apt-get install -y \
  chromium \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  xdg-utils \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set workdir
WORKDIR /usr/src/app

# Copy package files and install
COPY package*.json ./
RUN npm install --production

# Copy everything
COPY . .

# Expose port (in case you want to expose express)
EXPOSE 8080

# Make script executable
RUN chmod +x entrypoint.sh

# Copiar la sesión
COPY session-data /usr/src/app/session-data

CMD ["./entrypoint.sh"]