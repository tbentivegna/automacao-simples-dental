FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Evita baixar o Chromium de novo -- essa imagem já vem com ele pronto
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
