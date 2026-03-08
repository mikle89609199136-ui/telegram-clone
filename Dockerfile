FROM node:18-alpine

WORKDIR /app

# Установка зависимостей
COPY package*.json ./
RUN npm ci --only=production

# Копирование исходников
COPY . .

# Создание необходимых папок
RUN mkdir -p uploads logs data

# Открытие порта
EXPOSE 3000

# Запуск
CMD ["npm", "start"]
