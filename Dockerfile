FROM node:20

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    lsb-release \
    xdg-utils \
    wget \
    --no-install-recommends

WORKDIR /app
COPY . .

RUN npm install

ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
ENV CHROME_BIN="/usr/bin/chromium"

CMD ["npm", "start"]
