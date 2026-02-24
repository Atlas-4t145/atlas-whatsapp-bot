FROM browserless/chrome:latest

# Permanece como root para simplificar
# USER root (já é root por padrão)

WORKDIR /app

# Instala Node.js 18 e outras dependências necessárias
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["node", "index.js"]
