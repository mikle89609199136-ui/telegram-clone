FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000 3001 3002 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD node healthcheck.js

CMD ["npm", "start"]
