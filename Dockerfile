FROM browserless/chrome:latest

WORKDIR /app

# Instala Node.js 18 (a imagem browserless/chrome é baseada em Debian e pode não ter node)
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# Define o caminho do Chromium (já incluso na imagem)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["node", "index.js"]
