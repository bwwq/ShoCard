FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/app/data

EXPOSE 4173

CMD ["node", "server.mjs"]
