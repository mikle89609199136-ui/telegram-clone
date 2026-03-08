FROM node:18-alpine

WORKDIR /app

# Установка зависимостей
COPY package*.json ./
RUN npm ci --only=production

# Копирование исходников
COPY . .

# Сборка (если нужна)
# RUN npm run build

# Открытие порта
EXPOSE 3000

# Запуск
CMD ["npm", "start"]
