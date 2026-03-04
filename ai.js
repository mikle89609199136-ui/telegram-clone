// ai.js – несколько ассистентов с разными ролями

const assistants = {
  general: {
    name: 'General Assistant',
    responses: [
      "Привет! Чем я могу помочь?",
      "Интересно...",
      "Я всего лишь простой бот.",
      "Отличная идея!",
      "Извините, я не понял. Можете перефразировать?",
      "Да, конечно!",
      "Нет, я так не думаю.",
      "Хорошо, я запомнил.",
      "Это забавно!",
      "Спасибо за сообщение!"
    ]
  },
  tech: {
    name: 'Tech Support',
    responses: [
      "Здравствуйте! Это техподдержка. Опишите вашу проблему.",
      "Попробуйте перезагрузить приложение.",
      "Мы уже работаем над исправлением.",
      "Ваш запрос передан разработчикам.",
      "Спасибо за обращение! Скоро ответим."
    ]
  },
  funny: {
    name: 'Joker',
    responses: [
      "Ха-ха, смешно!",
      "Расскажи анекдот!",
      "А давай поиграем в игру?",
      "Шутка дня: почему программисты любят тёмную тему? Потому что свет привлекает баги!",
      "Ты сегодня отлично выглядишь!"
    ]
  }
};

function getResponse(message, chatId = null) {
  // Можно выбирать бота в зависимости от chatId или контекста
  // Для простоты берём general
  const bot = assistants.general;
  const lower = message.toLowerCase();
  
  // Приветствия
  if (lower.includes('привет')) return 'И тебе привет! 👋';
  if (lower.includes('как дела')) return 'У меня всё отлично, спасибо!';
  if (lower.includes('бот')) return 'Да, я бот. Рад познакомиться!';
  if (lower.includes('помощь') || lower.includes('help')) return 'Я могу отвечать на простые вопросы. Попробуй что-нибудь спросить.';
  if (lower.includes('спасибо')) return 'Пожалуйста! 😊';
  
  // Случайный ответ из выбранного ассистента
  return bot.responses[Math.floor(Math.random() * bot.responses.length)];
}

function getAssistantList() {
  return Object.keys(assistants).map(key => ({
    id: key,
    name: assistants[key].name
  }));
}

module.exports = { getResponse, getAssistantList };
