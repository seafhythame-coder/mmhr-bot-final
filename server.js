import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: 'uploads/' });
const { Pool } = pg;

// ✅ إعداد المجلدات اللازمة
const dirs = ['uploads', 'processed_files', 'data'];
dirs.forEach(dir => {
    if (!fs.existsSync(path.join(__dirname, dir))) {
        fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
    }
});

// ✅ نظام تخزين احتياطي (في حال فشل قاعدة البيانات)
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'local_db.json');
const getLocalDB = () => {
    if (!fs.existsSync(LOCAL_DB_PATH)) {
        return { users: [], documents: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
    } catch (e) {
        return { users: [], documents: [] };
    }
};
const saveLocalDB = (data) => {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2));
};

// ✅ محاولة الاتصال بقاعدة البيانات
let pool = null;
let useLocalDB = false;

const initDB = async () => {
    try {
        const config = process.env.DATABASE_URL
            ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
            : {
                user: process.env.DB_USER || 'postgres',
                host: process.env.DB_HOST || 'localhost',
                database: process.env.DB_NAME || 'mmhr_db',
                password: process.env.DB_PASSWORD || 'password',
                port: process.env.DB_PORT || 5432,
            };
        
        pool = new Pool(config);
        await pool.query('SELECT 1');
        console.log('✅ متصل بقاعدة بيانات PostgreSQL');
        
        // إنشاء الجداول
        const sqlPath = path.join(__dirname, 'DATABASE_SETUP.sql');
        if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, 'utf8');
            await pool.query(sql);
            console.log('✅ تم تحديث الجداول بنجاح');
        }
    } catch (err) {
        console.log('⚠️ فشل الاتصال بـ PostgreSQL. سيتم استخدام النظام المحلي (JSON):', err.message);
        useLocalDB = true;
    }
};

initDB();

// ✅ Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static('public'));

const SECRET_KEY = process.env.JWT_SECRET || 'mmhr_secret_key_2026';

// ✅ Middleware للمصادقة
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: '❌ لا يوجد Token' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: '❌ جلسة منتهية' });
        req.user = user;
        next();
    });
};

// 🔐 تسجيل مستخدم
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'بيانات ناقصة' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        if (useLocalDB) {
            const db = getLocalDB();
            if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'المستخدم موجود' });
            
            const newUser = { id: Date.now(), username, email, password: hashedPassword };
            db.users.push(newUser);
            saveLocalDB(db);
            return res.status(201).json({ status: 'success', user: { username, email } });
        }

        const result = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, hashedPassword]
        );
        res.status(201).json({ status: 'success', user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🔓 تسجيل دخول
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user;
        if (useLocalDB) {
            const db = getLocalDB();
            user = db.users.find(u => u.email === email);
        } else {
            const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            user = result.rows[0];
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'بيانات خاطئة' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, SECRET_KEY);
        res.json({ token, username: user.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 📤 رفع ومعالجة ملف
app.post('/api/documents/upload', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });

    const { path: filePath, originalname: fileName, mimetype: fileType, size: fileSize } = req.file;
    const userId = req.user.id;

    try {
        let documentId;
        if (useLocalDB) {
            const db = getLocalDB();
            const newDoc = { id: Date.now(), user_id: userId, file_name: fileName, file_path: filePath, status: 'processing', created_at: new Date() };
            db.documents.push(newDoc);
            saveLocalDB(db);
            documentId = newDoc.id;
        } else {
            const result = await pool.query(
                'INSERT INTO documents (user_id, file_name, file_path, file_type, file_size, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [userId, fileName, filePath, fileType, fileSize, 'processing']
            );
            documentId = result.rows[0].id;
        }

        // تشغيل معالج بايثون
        const python = spawn('python3', [path.join(__dirname, 'processor.py'), filePath, String(documentId)]);
        
        let output = '';
        python.stdout.on('data', (data) => output += data.toString());
        
        python.on('close', async (code) => {
            const status = code === 0 ? 'completed' : 'error';
            if (useLocalDB) {
                const db = getLocalDB();
                const doc = db.documents.find(d => d.id === documentId);
                if (doc) { doc.status = status; doc.processed_text = output; saveLocalDB(db); }
            } else {
                await pool.query('UPDATE documents SET status = $1, processed_text = $2 WHERE id = $3', [status, output, documentId]);
            }
        });

        res.json({ id: documentId, status: 'processing' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 📋 جلب المستندات
app.get('/api/documents', authenticateToken, async (req, res) => {
    try {
        if (useLocalDB) {
            const db = getLocalDB();
            const docs = db.documents.filter(d => d.user_id === req.user.id);
            return res.json(docs);
        }
        const result = await pool.query('SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 📊 الإحصائيات
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        let docs;
        if (useLocalDB) {
            docs = getLocalDB().documents.filter(d => d.user_id === req.user.id);
        } else {
            const result = await pool.query('SELECT * FROM documents WHERE user_id = $1', [req.user.id]);
            docs = result.rows;
        }

        res.json({
            totalDocuments: docs.length,
            processedDocuments: docs.filter(d => d.status === 'completed').length,
            pendingDocuments: docs.filter(d => d.status === 'processing').length,
            failedDocuments: docs.filter(d => d.status === 'error').length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على منفذ ${PORT} (قاعدة البيانات: ${useLocalDB ? 'محلي' : 'PostgreSQL'})`));
