/**
 * ИНСТРУКЦИЯ ПО ЗАПУСКУ ТОПОВОГО КОНВЕРТЕР-БОТА (grammY + Express + Render)
 * -------------------------------------------------------------
 * 1. Инициализация (если нет package.json): npm init -y
 * 2. Установка зависимостей:
 *    npm install grammy dotenv express fluent-ffmpeg ffmpeg-static axios
 * 3. Настройка окружения:
 *    Создайте файл .env и добавьте туда:
 *    BOT_TOKEN=ваш_telegram_токен
 * 4. Запуск:
 *    npm start
 * 
 * ДЕПЛОЙ НА RENDER:
 * - Создайте Web Service
 * - Подключите репозиторий
 * - Build Command: npm install
 * - Start Command: npm start
 * - В Environment Variables добавьте BOT_TOKEN
 */

require('dotenv').config();
const { Bot, Keyboard, InlineKeyboard, InputFile } = require('grammy');
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');

// Указываем путь к бинарнику FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// --- НАСТРОЙКИ ---
const PORT = process.env.PORT || 3000;
const token = process.env.BOT_TOKEN;

if (!token) {
    console.error('❌ ОШИБКА: BOT_TOKEN не задан! Добавьте его в .env или переменные окружения.');
    process.exit(1);
}

const bot = new Bot(token);
const app = express();

// --- HTTP ЗАГЛУШКА ДЛЯ RENDER ---
app.get('/', (req, res) => res.send('🚀 Telegram-бот конвертер успешно работает!'));
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌍 HTTP-сервер запущен на порту ${PORT}`);
});

// --- ДАННЫЕ В ПАМЯТИ ---
let stats = { conversions: 0 };
const sessions = new Map();
const generateId = () => Math.random().toString(36).substring(2, 10);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (Ограничение getFile)

// --- КЛАВИАТУРЫ ---
const mainMenu = new Keyboard()
    .text('🔄 Конвертировать').text('📋 Примеры').row()
    .text('❓ Помощь').text('📊 Статистика')
    .resized();

// --- ЛОГИРОВАНИЕ ---
const logAction = (user, action, status) => {
    const time = new Date().toISOString();
    const username = user?.username ? `@${user.username}` : user?.first_name || 'Unknown';
    console.log(`[${time}] User: ${username} | Action: ${action} | Status: ${status}`);
};

// --- КОМАНДЫ ---

// /start
bot.command('start', async (ctx) => {
    const welcomeText = `👋 *Привет! Я — твой личный бот-конвертер файлов.*\n\nОтправь мне файл (видео, аудио, картинку или голосовое), и я помогу изменить его формат прямо здесь 🪄\n\nВыбирай нужные действия в меню ниже 👇`;
    logAction(ctx.from, '/start', 'Success');
    await ctx.reply(welcomeText, { parse_mode: 'Markdown', reply_markup: mainMenu });
});

// /help
bot.command('help', async (ctx) => {
    const helpText = `❓ *Инструкция*\n\n1. Отправь мне любой поддерживаемый файл (до 20 МБ).\n2. Выбери из предложенных кнопок нужный формат.\n3. Дождись окончания конвертации!\n\nЕсли что-то зависло или не работает, попробуй отправить файл еще раз.`;
    logAction(ctx.from, '/help', 'Success');
    await ctx.reply(helpText, { parse_mode: 'Markdown', reply_markup: mainMenu });
});

// /formats
bot.command('formats', async (ctx) => {
    const formatText = `*Поддерживаемые форматы:*\n\n🎬 *Видео:* MP4, AVI, MOV, WEBM, MKV, FLV, WMV\n🎵 *Аудио:* MP3, WAV, OGG, M4A, FLAC, AAC, WMA\n🖼 *Изображения:* JPG, PNG, WEBP, BMP, TIFF, ICO`;
    logAction(ctx.from, '/formats', 'Success');
    await ctx.reply(formatText, { parse_mode: 'Markdown', reply_markup: mainMenu });
});

// --- ОБРАБОТКА МЕНЮ (Reply Keyboard) ---

bot.hears('🔄 Конвертировать', async (ctx) => {
    await ctx.reply('Жду твой файл! Просто отправь его мне в чат (как документ, фото, видео или аудио).\n\nПосмотреть список форматов можно командой /formats.', { reply_markup: mainMenu });
});

bot.hears('📋 Примеры', async (ctx) => {
    const examplesText = `📋 *Примеры работы:*\n\n1️⃣ Отправляешь *видео .MKV*\n➡️ Получаешь кнопочку внизу\n➡️ Выбираешь *MP4*\n➡️ Бот присылает гото видео (читается на всех телефонах).\n\n2️⃣ Отправляешь *голосовое .OGG*\n➡️ Выбираешь *MP3*\n➡️ Сохраняешь как обычный трек.\n\n3️⃣ Кидаешь стикер или картинку *.WEBP*\n➡️ Выбираешь *JPG*\n➡️ Сохраняешь нормальное фото для соцсетей.`;
    await ctx.reply(examplesText, { parse_mode: 'Markdown' });
});

bot.hears('❓ Помощь', async (ctx) => {
    await ctx.reply('❓ *Инструкция*\n\n1. Отправь мне любой поддерживаемый файл (до 20 МБ).\n2. Выбери из предложенных кнопок нужный формат.\n3. Дождись окончания конвертации!\n\nЕсли что-то пошло не так, просто отправь файл еще раз.', { parse_mode: 'Markdown' });
});

bot.hears('📊 Статистика', async (ctx) => {
    await ctx.reply(`📊 *Статистика бота:*\n\nУспешных конвертаций: *${stats.conversions}*\n\n(Данные сбрасываются при перезапуске сервера)`, { parse_mode: 'Markdown' });
});

// --- ОБРАБОТКА ВХОДЯЩИХ ФАЙЛОВ ---
bot.on(['message:document', 'message:video', 'message:audio', 'message:voice', 'message:photo'], async (ctx) => {
    let fileId, fileType, defaultName;
    const msg = ctx.message;

    if (msg.document) {
        fileId = msg.document.file_id;
        fileType = 'document';
        defaultName = msg.document.file_name || 'document';
    } else if (msg.video) {
        fileId = msg.video.file_id;
        fileType = 'video';
        defaultName = msg.video.file_name || 'video.mp4';
    } else if (msg.audio) {
        fileId = msg.audio.file_id;
        fileType = 'audio';
        defaultName = msg.audio.file_name || 'audio.mp3';
    } else if (msg.voice) {
        fileId = msg.voice.file_id;
        fileType = 'voice';
        defaultName = 'voice.ogg';
    } else if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id; // Высшее качество
        fileType = 'photo';
        defaultName = 'image.jpg';
    }

    try {
        const fileInfo = await ctx.api.getFile(fileId);
        
        // Ошибка: Файл слишком большой
        if (fileInfo.file_size > MAX_FILE_SIZE) {
            logAction(ctx.from, `Upload File (${defaultName})`, 'Error: Too Large');
            return ctx.reply('❌ Файл слишком большой!\n\nИз-за ограничений Telegram API, боты могут скачивать файлы размером только *до 20 МБ*. Пожалуйста, уменьшите размер или отправьте другой файл.', { parse_mode: 'Markdown' });
        }

        const sid = generateId();
        sessions.set(sid, { 
            fileId, 
            fileName: defaultName, 
            fileType, 
            filePath: fileInfo.file_path 
        });

        const inlineKeyboard = new InlineKeyboard();
        let isMedia = false;

        const extMatch = defaultName.match(/\.(mp4|avi|mov|webm|mkv|flv|wmv|mp3|wav|ogg|m4a|flac|aac|wma|jpg|jpeg|png|webp|bmp|tiff|tif|ico)$/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : '';
        
        if (fileType === 'video' || ['mp4','avi','mov','webm','mkv','flv','wmv'].includes(ext)) {
            inlineKeyboard
                .text('🎬 MP4', `conv:${sid}:mp4`)
                .text('🎬 AVI', `conv:${sid}:avi`)
                .text('🎬 MKV', `conv:${sid}:mkv`).row()
                .text('🎬 WEBM', `conv:${sid}:webm`)
                .text('🎬 MOV', `conv:${sid}:mov`)
                .text('🎞 GIF', `conv:${sid}:gif`).row()
                .text('🎵 Извлечь MP3', `conv:${sid}:mp3`);
            isMedia = true;
        } else if (fileType === 'audio' || fileType === 'voice' || ['mp3','wav','ogg','m4a','flac','aac','wma'].includes(ext)) {
            inlineKeyboard
                .text('🎵 MP3', `conv:${sid}:mp3`)
                .text('🎵 WAV', `conv:${sid}:wav`)
                .text('🎵 OGG', `conv:${sid}:ogg`).row()
                .text('🎵 M4A', `conv:${sid}:m4a`)
                .text('🎵 FLAC', `conv:${sid}:flac`)
                .text('🎵 AAC', `conv:${sid}:aac`);
            isMedia = true;
        } else if (fileType === 'photo' || ['jpg','jpeg','png','webp','bmp','tiff','tif','ico'].includes(ext)) {
            inlineKeyboard
                .text('🖼 JPG', `conv:${sid}:jpg`)
                .text('🖼 PNG', `conv:${sid}:png`)
                .text('🖼 WEBP', `conv:${sid}:webp`).row()
                .text('🖼 BMP', `conv:${sid}:bmp`)
                .text('🖼 TIFF', `conv:${sid}:tiff`)
                .text('🖼 ICO', `conv:${sid}:ico`);
            isMedia = true;
        }

        // Ошибка: Неподдерживаемый формат
        if (!isMedia) {
            logAction(ctx.from, `Upload File (${defaultName})`, 'Error: Unsupported');
            return ctx.reply(`❓ Я пока не умею конвертировать этот формат.\n\nПосмотреть список того, что я умею, можно по команде /formats.`, { parse_mode: 'Markdown' });
        }

        logAction(ctx.from, `Upload File (${defaultName})`, 'Success');
        await ctx.reply('В какой формат конвертировать?', { reply_markup: inlineKeyboard });

    } catch (e) {
        logAction(ctx.from, `Upload File (${defaultName})`, 'Error: Corrupt or Fetch Failed');
        console.error('ОШИБКА ПОЛУЧЕНИЯ ФАЙЛА:', e);
        await ctx.reply('❌ Ошибка при получении файла. Возможно, он поврежден или недоступен.');
    }
});

// Обработка текстовых сообщений
bot.on('message:text', async (ctx) => {
    if (!ctx.message.text.startsWith('/')) { 
        logAction(ctx.from, 'Text Input', 'Reminded');
        await ctx.reply('👀 Пожалуйста, отправь мне *файл* для конвертации, а не текст. Если нужна помощь, жми «❓ Помощь» в меню.', { parse_mode: 'Markdown', reply_markup: mainMenu });
    }
});

// --- ОБРАБОТКА ВЫБОРА ФОРМАТА (Inline Buttons) ---
bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('conv:')) return;
    
    await ctx.answerCallbackQuery();

    const [, sid, targetFormat] = data.split(':');
    const session = sessions.get(sid);

    if (!session) {
        return ctx.editMessageText('❌ Ошибка: сессия конвертации устарела. Отправьте файл снова.');
    }

    logAction(ctx.from, `Conversion started -> ${targetFormat}`, 'In Progress');

    const progressMsg = await ctx.editMessageText('⏳ Скачиваю файл...');
    
    const fileLink = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${session.filePath}`;

    const tmpDir = os.tmpdir();
    const inputExt = path.extname(session.fileName) || '.tmp';
    const inputPath = path.join(tmpDir, `${sid}_in${inputExt}`);
    const outputPath = path.join(tmpDir, `${sid}_out.${targetFormat}`);

    let actionInterval;

    try {
        const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(inputPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        await ctx.api.editMessageText(ctx.chat.id, progressMsg.message_id, `⚙️ Конвертирую в ${targetFormat.toUpperCase()}...`);

        let lastProgressUpdate = 0;
        
        actionInterval = setInterval(() => {
            ctx.replyWithChatAction('record_video').catch(() => {});
        }, 3000);

        await new Promise((resolve, reject) => {
             let command = ffmpeg(inputPath).toFormat(targetFormat);
             
             if (targetFormat === 'gif') {
                 command = command.fps(10).size('320x?');
             } else if (targetFormat === 'mp4') {
                 command = command.videoCodec('libx264').outputOptions('-pix_fmt yuv420p');
             }

             command.on('progress', (progress) => {
                 if (progress.percent && !isNaN(progress.percent)) {
                     const percent = Math.min(Math.max(Math.round(progress.percent), 0), 100);
                     const now = Date.now();
                     if (now - lastProgressUpdate > 2000) {
                         lastProgressUpdate = now;
                         const filledChars = Math.round(percent / 10);
                         const emptyChars = Math.max(0, 10 - filledChars);
                         const bar = '█'.repeat(filledChars) + '░'.repeat(emptyChars);
                         
                         ctx.api.editMessageText(
                             ctx.chat.id, 
                             progressMsg.message_id, 
                             `⚙️ Конвертирую в ${targetFormat.toUpperCase()}...\n\n${bar} ${percent}%`
                         ).catch(() => {});
                     }
                 }
             })
             .on('end', resolve)
             .on('error', reject)
             .save(outputPath);
        });

        clearInterval(actionInterval);

        await ctx.replyWithChatAction('upload_document').catch(() => {});
        await ctx.api.editMessageText(ctx.chat.id, progressMsg.message_id, '✅ Готово! Загружаю файл в Telegram...');
        
        await ctx.replyWithDocument(new InputFile(outputPath));
        await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
        
        stats.conversions++;
        logAction(ctx.from, `Conversion Finished -> ${targetFormat}`, 'Success');

    } catch (err) {
        console.error('ОШИБКА КОНВЕРТАЦИИ:', err);
        logAction(ctx.from, `Conversion ${targetFormat}`, `Error`);
        await ctx.reply(`❌ Произошла ошибка при конвертации. Возможно формат не поддерживается для данного исходного файла.`);
        await ctx.api.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
    } finally {
        if (actionInterval) clearInterval(actionInterval);
        sessions.delete(sid);
        
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
    }
});

// Обработка ошибок grammY
bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e && e.description) {
        console.error('Telegram API Error:', e.description);
    } else {
        console.error('Unknown Error:', e);
    }
});

// --- ЗАПУСК БОТА ---
const startBot = async () => {
    try {
        // Удаляем вебхуки на всякий случай перед запуском polling
        await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
        console.log('Подключение к Telegram API...');
        await bot.start({
            drop_pending_updates: true, // Игнорируем старые апдейты, если бот лежал
            onStart: (botInfo) => {
                console.log(`🤖 Бот @${botInfo.username} успешно запущен!`);
            }
        });
    } catch (err) {
        // Ошибка 409 означает, что Render еще не успел убить старый процесс при деплое
        if (err.description && err.description.includes('409') || err.error_code === 409) {
            console.log('⚠️ Конфликт поллинга (409). Старый процесс еще завершается. Пробуем снова через 5 секунд...');
            setTimeout(startBot, 5000);
        } else {
            console.error('❌ Ошибка при запуске:', err);
            process.exit(1);
        }
    }
};

startBot();

// --- ПРАВИЛЬНОЕ ЗАВЕРШЕНИЕ (Graceful Shutdown) ---
const shutdown = async (signal) => {
    console.log(`\n⚠️ Получен сигнал ${signal}. Начинаем безопасное завершение...`);
    
    try {
        console.log('Останавливаем polling бота...');
        await bot.stop();
        
        console.log('Закрываем HTTP сервер...');
        server.close(() => {
            console.log('🛑 Сервер остановлен');
            process.exit(0);
        });
        
        // Принудительное завершение через 10 секунд
        setTimeout(() => {
            console.error('❗️ Принудительное завершение из-за таймаута.');
            console.log('🛑 Сервер остановлен');
            process.exit(1);
        }, 10000);
    } catch (error) {
        console.error('❌ Ошибка при остановке:', error);
        process.exit(1);
    }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
