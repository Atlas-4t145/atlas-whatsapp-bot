FROM browserless/chrome:latest

# Muda para root para poder instalar pacotes
USER root

WORKDIR /app

# Instala Node.js 18 e outras dependências necessárias
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Volta para o usuário browserless (recomendado para segurança)
USER browserless

COPY package*.json ./
RUN npm install

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["node", "index.js"]
