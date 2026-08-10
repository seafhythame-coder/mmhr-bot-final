-- ═══════════════════════════════════════════════════════════════════
-- 📊 إعداد قاعدة البيانات لنظام MMHR
-- ═══════════════════════════════════════════════════════════════════
-- 
-- الاستخدام:
-- 1. افتح PostgreSQL
-- 2. انسخ والصق هذه الأوامر
-- 3. شغل الأوامر بالترتيب
-- 
-- ═══════════════════════════════════════════════════════════════════

-- ✅ 1️⃣  إنشاء قاعدة البيانات
CREATE DATABASE mmhr_db;

-- ✅ 2️⃣  الاتصال بقاعدة البيانات الجديدة


-- ═══════════════════════════════════════════════════════════════════
-- ✅ 3️⃣  إنشاء جدول المستخدمين
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- إنشاء Index للسرعة
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- ═══════════════════════════════════════════════════════════════════
-- ✅ 4️⃣  إنشاء جدول المستندات
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    status VARCHAR(50) DEFAULT 'pending',
    -- pending = في الانتظار
    -- processing = جاري المعالجة
    -- completed = مكتمل
    -- error = خطأ
    processed_text TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- إنشاء Indexes للسرعة
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_created_at ON documents(created_at);

-- ═══════════════════════════════════════════════════════════════════
-- ✅ 5️⃣  إنشاء جدول السجلات (Logs)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    action VARCHAR(100),
    -- upload = رفع ملف
    -- download = تحميل ملف
    -- delete = حذف ملف
    -- login = دخول
    -- register = تسجيل
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- إنشاء Index للسرعة
CREATE INDEX idx_logs_user_id ON logs(user_id);
CREATE INDEX idx_logs_created_at ON logs(created_at);

-- ═══════════════════════════════════════════════════════════════════
-- ✅ 6️⃣  إنشاء جدول الإحصائيات
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE statistics (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_documents INTEGER DEFAULT 0,
    total_processed INTEGER DEFAULT 0,
    total_size_mb DECIMAL(10, 2) DEFAULT 0,
    last_upload TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════
-- ✅ 7️⃣  إنشاء مستخدم خاص بقاعدة البيانات
-- ═══════════════════════════════════════════════════════════════════

-- إنشاء المستخدم
CREATE USER mmhr_user WITH PASSWORD 'secure_password_here';

-- إعطاء الصلاحيات
GRANT ALL PRIVILEGES ON DATABASE mmhr_db TO mmhr_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mmhr_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mmhr_user;

-- ═══════════════════════════════════════════════════════════════════
-- ✅ 8️⃣  إنشاء Views مفيدة
-- ═══════════════════════════════════════════════════════════════════

-- View: الملفات المعالجة
CREATE VIEW completed_documents AS
SELECT 
    d.id,
    d.file_name,
    d.file_size,
    d.created_at,
    u.username,
    u.email
FROM documents d
JOIN users u ON d.user_id = u.id
WHERE d.status = 'completed';

-- View: إحصائيات المستخدمين
CREATE VIEW user_statistics AS
SELECT 
    u.id,
    u.username,
    u.email,
    COUNT(d.id) as total_documents,
    SUM(CASE WHEN d.status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN d.status = 'processing' THEN 1 ELSE 0 END) as processing,
    SUM(CASE WHEN d.status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END) as errors,
    COALESCE(SUM(d.file_size), 0) as total_size_bytes
FROM users u
LEFT JOIN documents d ON u.id = d.user_id
GROUP BY u.id, u.username, u.email;

-- ═══════════════════════════════════════════════════════════════════
-- ✅ تحقق من التثبيت
-- ═══════════════════════════════════════════════════════════════════

-- عرض جميع الجداول
\dt

-- عرض المستخدمين
SELECT * FROM pg_user WHERE usename = 'mmhr_user';

-- ═══════════════════════════════════════════════════════════════════
-- ✅ أوامر مفيدة
-- ═══════════════════════════════════════════════════════════════════

-- حذف قاعدة البيانات (استخدم بحذر!)
-- DROP DATABASE IF EXISTS mmhr_db;

-- حذف جميع البيانات من الجداول
-- TRUNCATE TABLE documents, users, logs, statistics;

-- حذف المستخدم mmhr_user
-- DROP USER IF EXISTS mmhr_user;

-- ═══════════════════════════════════════════════════════════════════
-- 🎉 انتهى! قاعدة البيانات جاهزة للاستخدام
-- ═══════════════════════════════════════════════════════════════════
