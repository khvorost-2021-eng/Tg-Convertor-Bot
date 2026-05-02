process.env.NTBA_FIX_350 = 1; // Убирает предупреждение node-telegram-bot-api
require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');

// Указываем путь к бинарнику FFmpeg (чтобы не устанавливать его глобально)
ffmpeg.setFfmpegPath(ffmpegPath);

// --- HTTP ЗАГЛУШКА ДЛЯ RENDER ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Файловый конвертер (Telegram Bot) работает!'));
app.listen(PORT, '0.0.0.0', () => console.log(`HTTP-сервер запущен на порту ${PORT}`));

// --- ИНИЦИАЛИЗАЦИЯ БОТА ---
const token = process.env.BOT_TOKEN;
if (!token) {
    console.warn('ВНИМАНИЕ: BOT_TOKEN не задан! Бот не активен.');
}

const bot = token ? new TelegramBot(token, { polling: true }) : null;

// Храним данные сессий для кнопок
const sessions = new Map();
const generateId = () => Math.random().toString(36).substring(2, 10);

// Лимит для getFile в Telegram API (20 MB)
// (50 МБ работает для webhook, но для polling через getFile лимит 20 МБ)
const MAX_FILE_SIZE = 20 * 1024 * 1024; 

if (bot) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;

        if (msg.text === '/start' || msg.text === '/help') {
            const welcomeText = `👋 *Привет! Я — бот-конвертер файлов.*

Отправь мне файл (видео, аудио, картинку или голосовое), и я помогу изменить его формат 🪄

*Поддерживаемые форматы:*
🎬 *Видео:* MP4, AVI, MOV, WEBM, MKV, FLV, WMV
🎵 *Аудио:* MP3, WAV, OGG, M4A, FLAC, AAC, WMA
🖼 *Изображения:* JPG, PNG, WEBP, BMP, TIFF, ICO

⚠️ Ограничение размера: *20 МБ* (лимит Telegram).`;
            return bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
        }

        let file = null, fileType = null, defaultName = 'file';

        // Определяем тип отправленного файла
        if (msg.document) {
            file = msg.document;
            fileType = 'document';
            defaultName = msg.document.file_name || 'document';
        } else if (msg.video) {
            file = msg.video; 
            fileType = 'video'; 
            defaultName = msg.video.file_name || 'video.mp4';
        } else if (msg.audio) {
            file = msg.audio; 
            fileType = 'audio'; 
            defaultName = msg.audio.file_name || 'audio.mp3';
        } else if (msg.voice) {
            file = msg.voice; 
            fileType = 'voice'; 
            defaultName = 'voice.ogg';
        } else if (msg.photo && msg.photo.length > 0) {
            file = msg.photo[msg.photo.length - 1]; // Берем最高е качество
            fileType = 'photo'; 
            defaultName = 'image.jpg';
        }

        if (!file) return; // Игнорируем обычный текст

        // Проверяем размер файла
        if (file.file_size && file.file_size > MAX_FILE_SIZE) {
            return bot.sendMessage(chatId, '❌ Файл слишком большой! Из-за ограничений Telegram API боты могут скачивать файлы только до 20 МБ.');
        }

        const sid = generateId();
        sessions.set(sid, { fileId: file.file_id, fileName: defaultName, fileType });

        let inline_keyboard = [];
        let isMedia = false;

        // Предлагаем форматы в зависимости от типа расширения
        if (fileType === 'video' || defaultName.match(/\.(mp4|avi|mov|webm|mkv|flv|wmv)$/i)) {
            inline_keyboard = [
                [
                    { text: '🎬 MP4', callback_data: `conv:${sid}:mp4` },
                    { text: '🎬 AVI', callback_data: `conv:${sid}:avi` },
                    { text: '🎬 MKV', callback_data: `conv:${sid}:mkv` }
                ],
                [
                    { text: '🎬 WEBM', callback_data: `conv:${sid}:webm` },
                    { text: '🎬 MOV', callback_data: `conv:${sid}:mov` },
                    { text: '🎞 GIF', callback_data: `conv:${sid}:gif` }
                ],
                [
                    { text: '🎵 Извлечь MP3', callback_data: `conv:${sid}:mp3` }
                ]
            ];
            isMedia = true;
        } else if (fileType === 'audio' || fileType === 'voice' || defaultName.match(/\.(mp3|wav|ogg|m4a|flac|aac|wma)$/i)) {
            inline_keyboard = [
                [
                    { text: '🎵 MP3', callback_data: `conv:${sid}:mp3` },
                    { text: '🎵 WAV', callback_data: `conv:${sid}:wav` },
                    { text: '🎵 OGG', callback_data: `conv:${sid}:ogg` }
                ],
                [
                    { text: '🎵 M4A', callback_data: `conv:${sid}:m4a` },
                    { text: '🎵 FLAC', callback_data: `conv:${sid}:flac` },
                    { text: '🎵 AAC', callback_data: `conv:${sid}:aac` }
                ]
            ];
            isMedia = true;
        } else if (fileType === 'photo' || defaultName.match(/\.(jpg|jpeg|png|webp|bmp|tiff|tif|ico)$/i)) {
            inline_keyboard = [
                [
                    { text: '🖼 JPG', callback_data: `conv:${sid}:jpg` },
                    { text: '🖼 PNG', callback_data: `conv:${sid}:png` },
                    { text: '🖼 WEBP', callback_data: `conv:${sid}:webp` }
                ],
                [
                    { text: '🖼 BMP', callback_data: `conv:${sid}:bmp` },
                    { text: '🖼 TIFF', callback_data: `conv:${sid}:tiff` },
                    { text: '🖼 ICO', callback_data: `conv:${sid}:ico` }
                ]
            ];
            isMedia = true;
        }

        if (!isMedia) {
            return bot.sendMessage(chatId, '❓ Данный тип файла пока не поддерживается.');
        }

        bot.sendMessage(chatId, 'В какой формат конвертировать?', {
            reply_markup: { inline_keyboard }
        });
    });

    // Обрабатываем нажатия кнопок
    bot.on('callback_query', async (query) => {
        const data = query.data;
        const msg = query.message;
        const chatId = msg.chat.id;

        if (!data.startsWith('conv:')) return;
        const [, sid, targetFormat] = data.split(':');

        const session = sessions.get(sid);
        if (!session) {
            return bot.sendMessage(chatId, '❌ Ошибка: сессия конвертации устарела. Отправьте файл снова.');
        }
        bot.answerCallbackQuery(query.id);

        const progressMsg = await bot.sendMessage(chatId, '⏳ Скачиваю файл...');
        
        let loadingDots = 0;
        let actionInterval = setInterval(() => {
            loadingDots = (loadingDots + 1) % 4;
            const dots = '.'.repeat(loadingDots);
            bot.editMessageText(`⏳ Скачиваю файл${dots}`, {
                chat_id: chatId, message_id: progressMsg.message_id
            }).catch(() => {});
            bot.sendChatAction(chatId, 'typing').catch(() => {});
        }, 1500);

        const tmpDir = os.tmpdir();
        const inputExt = path.extname(session.fileName) || '.tmp';
        const inputPath = path.join(tmpDir, `${sid}_in${inputExt}`);
        const outputPath = path.join(tmpDir, `${sid}_out.${targetFormat}`);

        try {
            // 1. Скачивание
            const fileLink = await bot.getFileLink(session.fileId);
            const response = await axios({ url: fileLink, method: 'GET', responseType: 'stream' });
            const writer = fs.createWriteStream(inputPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            clearInterval(actionInterval);

            // 2. Конвертация
            await bot.editMessageText(`⚙️ Конвертирую в ${targetFormat.toUpperCase()}...`, {
                chat_id: chatId, message_id: progressMsg.message_id
            }).catch(() => {});

            let lastProgressUpdate = 0;
            
            actionInterval = setInterval(() => {
                bot.sendChatAction(chatId, 'record_video').catch(() => {});
            }, 3000);

            await new Promise((resolve, reject) => {
                 let command = ffmpeg(inputPath).toFormat(targetFormat);
                 
                 // Специфичные флаги
                 if (targetFormat === 'gif') {
                     command = command.fps(10).size('320x?'); // Оптимизация размера GIF
                 } else if (targetFormat === 'mp4') {
                     command = command.videoCodec('libx264');
                 }

                 command.on('progress', (progress) => {
                     if (progress.percent && !isNaN(progress.percent)) {
                         const percent = Math.min(Math.max(Math.round(progress.percent), 0), 100);
                         const now = Date.now();
                         // Обновляем сообщение раз в 2 секунды, чтобы не попасть под rate limit (Too Many Requests)
                         if (now - lastProgressUpdate > 2000) {
                             lastProgressUpdate = now;
                             const filledChars = Math.round(percent / 10);
                             const emptyChars = Math.max(0, 10 - filledChars);
                             const bar = '█'.repeat(filledChars) + '░'.repeat(emptyChars);
                             
                             bot.editMessageText(`⚙️ Конвертирую в ${targetFormat.toUpperCase()}...\n\n${bar} ${percent}%`, {
                                 chat_id: chatId, message_id: progressMsg.message_id
                             }).catch(() => {});
                         }
                     }
                 })
                 .on('end', resolve)
                 .on('error', reject)
                 .save(outputPath);
            });

            clearInterval(actionInterval);

            // 3. Отправка
            bot.sendChatAction(chatId, 'upload_document').catch(() => {});
            await bot.editMessageText('✅ Готово! Отправляю файл...', {
                chat_id: chatId, message_id: progressMsg.message_id
            });

            await bot.sendDocument(chatId, outputPath, {}, { contentType: 'application/octet-stream' });
            bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});

        } catch (err) {
            console.error(err);
            bot.sendMessage(chatId, `❌ Произошла ошибка: ${err.message}`);
            bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
        } finally {
            clearInterval(actionInterval);
            // 4. Очистка
            sessions.delete(sid);
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
        }
    });
}
