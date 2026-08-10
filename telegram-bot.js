import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000';

if (!TELEGRAM_TOKEN) {
    console.error('❌ خطأ: TELEGRAM_BOT_TOKEN غير موجود في ملف .env');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const userSessions = new Map();

console.log('🤖 بوت تيليجرام قيد التشغيل...');

// 🏠 القائمة الرئيسية
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '📤 رفع ملف' }, { text: '📋 مستنداتي' }],
            [{ text: '📊 الإحصائيات' }, { text: '🔐 دخول / تسجيل' }]
        ],
        resize_keyboard: true
    }
};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `👋 أهلاً بك في **MMHR**\nنظامك الذكي لمعالجة المستندات.`, { parse_mode: 'Markdown', ...mainKeyboard });
});

bot.onText(/🔐 دخول \/ تسجيل|\/login|\/register/, (msg) => {
    bot.sendMessage(msg.chat.id, 'أرسل بريدك الإلكتروني للبدء:', { reply_markup: { force_reply: true } });
    userSessions.set(msg.chat.id, { step: 'email' });
});

bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return;
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);

    if (session?.step === 'email') {
        session.email = msg.text;
        session.step = 'password';
        bot.sendMessage(chatId, 'أرسل كلمة المرور الآن:');
    } else if (session?.step === 'password') {
        const password = msg.text;
        try {
            bot.sendMessage(chatId, '⏳ جاري التحقق...');
            // محاولة تسجيل دخول، إذا فشل نحاول التسجيل
            try {
                const res = await axios.post(`${API_BASE_URL}/api/auth/login`, { email: session.email, password });
                session.token = res.data.token;
                session.step = null;
                bot.sendMessage(chatId, `✅ تم الدخول بنجاح! مرحباً ${res.data.username}`, mainKeyboard);
            } catch (e) {
                // محاولة التسجيل
                await axios.post(`${API_BASE_URL}/api/auth/register`, { username: session.email.split('@')[0], email: session.email, password });
                const res = await axios.post(`${API_BASE_URL}/api/auth/login`, { email: session.email, password });
                session.token = res.data.token;
                session.step = null;
                bot.sendMessage(chatId, `✅ تم إنشاء حساب جديد والدخول بنجاح!`, mainKeyboard);
            }
        } catch (err) {
            bot.sendMessage(chatId, `❌ خطأ: ${err.response?.data?.error || 'فشل الاتصال بالسيرفر'}`);
            userSessions.delete(chatId);
        }
    }
});

// 📤 معالجة الملفات
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);

    if (!session?.token) return bot.sendMessage(chatId, '❌ يرجى تسجيل الدخول أولاً.');

    try {
        bot.sendMessage(chatId, '📥 استلمت الملف، جاري رفعه ومعالجته...');
        const fileLink = await bot.getFileLink(msg.document.file_id);
        const fileStream = await axios.get(fileLink, { responseType: 'stream' });
        
        const form = new FormData();
        form.append('file', fileStream.data, msg.document.file_name);

        const res = await axios.post(`${API_BASE_URL}/api/documents/upload`, form, {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${session.token}` }
        });

        bot.sendMessage(chatId, `✅ تم الرفع! رقم الطلب: ${res.data.id}\nسأخبرك فور انتهاء المعالجة.`);
        
        // مراقبة بسيطة
        let checkCount = 0;
        const checker = setInterval(async () => {
            checkCount++;
            try {
                const statusRes = await axios.get(`${API_BASE_URL}/api/documents`, {
                    headers: { Authorization: `Bearer ${session.token}` }
                });
                const doc = statusRes.data.find(d => d.id == res.data.id);
                if (doc && doc.status === 'completed') {
                    clearInterval(checker);
                    bot.sendMessage(chatId, `✨ **انتهت المعالجة!**\n📄 الملف: ${doc.file_name}\n\nالنص المستخرج:\n\`\`\`\n${doc.processed_text?.substring(0, 3000)}...\n\`\`\``, { parse_mode: 'Markdown' });
                } else if (doc && doc.status === 'error') {
                    clearInterval(checker);
                    bot.sendMessage(chatId, '❌ حدث خطأ أثناء تحليل الملف.');
                }
            } catch (e) {}
            if (checkCount > 20) clearInterval(checker);
        }, 5000);

    } catch (err) {
        bot.sendMessage(chatId, `❌ فشل الرفع: ${err.response?.data?.error || err.message}`);
    }
});

bot.onText(/📋 مستنداتي/, async (msg) => {
    const session = userSessions.get(msg.chat.id);
    if (!session?.token) return bot.sendMessage(msg.chat.id, '❌ سجل دخولك أولاً.');
    try {
        const res = await axios.get(`${API_BASE_URL}/api/documents`, { headers: { Authorization: `Bearer ${session.token}` } });
        const list = res.data.map((d, i) => `${i+1}. ${d.file_name} [${d.status}]`).join('\n');
        bot.sendMessage(msg.chat.id, `📋 **قائمة ملفاتك:**\n${list || 'لا يوجد ملفات'}`);
    } catch (e) { bot.sendMessage(msg.chat.id, '❌ فشل جلب القائمة'); }
});

bot.onText(/📊 الإحصائيات/, async (msg) => {
    const session = userSessions.get(msg.chat.id);
    if (!session?.token) return bot.sendMessage(msg.chat.id, '❌ سجل دخولك أولاً.');
    try {
        const res = await axios.get(`${API_BASE_URL}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${session.token}` } });
        const s = res.data;
        bot.sendMessage(msg.chat.id, `📊 **إحصائياتك:**\n- الإجمالي: ${s.totalDocuments}\n- مكتمل: ${s.processedDocuments}\n- قيد المعالجة: ${s.pendingDocuments}\n- أخطاء: ${s.failedDocuments}`);
    } catch (e) { bot.sendMessage(msg.chat.id, '❌ فشل جلب الإحصائيات'); }
});
