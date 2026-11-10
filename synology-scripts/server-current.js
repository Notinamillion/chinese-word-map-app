const express = require('express');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const translate = require('@vitalets/google-translate-api');
const { pinyin } = require('pinyin-pro');
const multer = require('multer');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'database', 'chinese-app.db');
const IMAGES_DIR = path.join(__dirname, 'images');

let db;

// Initialize SQL.js database
async function initDatabase() {
    const SQL = await initSqlJs();

    // Try to load existing database
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('[DB] Database loaded from', DB_PATH);
    } else {
        db = new SQL.Database();
        console.log('[DB] Creating new database');
    }

    // ALWAYS ensure all tables exist (safe with IF NOT EXISTS)
    // Create users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            is_admin INTEGER DEFAULT 0,
            is_blocked INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        )
    `);

    // Create progress table
    db.run(`
        CREATE TABLE IF NOT EXISTS progress (
            user_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Create custom_words table
    db.run(`
        CREATE TABLE IF NOT EXISTS custom_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            pinyin TEXT,
            meanings TEXT NOT NULL,
            base_char TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, word)
        )
    `);

    // Migrate existing databases - add is_admin column
    try {
        db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
        console.log('[MIGRATION] Added is_admin column to users table');
    } catch (error) {
        // Column already exists, ignore
        if (!error.message.includes('duplicate column')) {
            console.error('[MIGRATION] Error adding is_admin column:', error);
        }
    }

    // Migrate existing databases - add is_blocked column
    try {
        db.run('ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0');
        console.log('[MIGRATION] Added is_blocked column to users table');
    } catch (error) {
        // Column already exists, ignore
        if (!error.message.includes('duplicate column')) {
            console.error('[MIGRATION] Error adding is_blocked column:', error);
        }
    }

    // Migrate existing databases - add can_edit_definitions column
    try {
        db.run('ALTER TABLE users ADD COLUMN can_edit_definitions INTEGER DEFAULT 1');
        console.log('[MIGRATION] Added can_edit_definitions column to users table');
    } catch (error) {
        if (!error.message.includes('duplicate column')) {
            console.error('[MIGRATION] Error adding can_edit_definitions column:', error);
        }
    }

    // Migrate existing databases - add can_upload_images column
    try {
        db.run('ALTER TABLE users ADD COLUMN can_upload_images INTEGER DEFAULT 1');
        console.log('[MIGRATION] Added can_upload_images column to users table');
    } catch (error) {
        if (!error.message.includes('duplicate column')) {
            console.error('[MIGRATION] Error adding can_upload_images column:', error);
        }
    }

    // Create word_edits table (for editing meanings of any word)
    db.run(`
        CREATE TABLE IF NOT EXISTS word_edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            word_type TEXT NOT NULL,
            edited_meanings TEXT NOT NULL,
            edited_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(word, word_type)
        )
    `);

    // Create word_images table (for storing image uploads)
    db.run(`
        CREATE TABLE IF NOT EXISTS word_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            word_type TEXT NOT NULL,
            image_filename TEXT NOT NULL,
            uploaded_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(word, word_type)
        )
    `);

    // Create user_sentences table (for custom user sentences)
    db.run(`
        CREATE TABLE IF NOT EXISTS user_sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            chinese TEXT NOT NULL,
            pinyin TEXT NOT NULL,
            english TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Auth tokens table (persists across restarts)
    db.run(`
        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            expires INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Load persisted tokens back into memory map
    try {
        var tokenRows = db.exec('SELECT token, user_id, username, is_admin, expires FROM auth_tokens WHERE expires > ?', [Date.now()]);
        if (tokenRows.length > 0) {
            tokenRows[0].values.forEach(function(row) {
                authTokens.set(row[0], { userId: row[1], username: row[2], isAdmin: row[3] === 1, expires: row[4] });
            });
            console.log('[AUTH] Loaded ' + tokenRows[0].values.length + ' persisted tokens');
        }
        // Clean up expired tokens
        db.run('DELETE FROM auth_tokens WHERE expires <= ?', [Date.now()]);
    } catch(e) {
        console.error('[AUTH] Failed to load persisted tokens:', e.message);
    }

    // Quiz history table
    db.run(`
        CREATE TABLE IF NOT EXISTS quiz_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            word_type TEXT,
            quiz_mode TEXT,
            quality INTEGER,
            is_correct INTEGER DEFAULT 0,
            interval_before REAL DEFAULT 0,
            interval_after REAL DEFAULT 0,
            easiness_before REAL DEFAULT 2.5,
            easiness_after REAL DEFAULT 2.5,
            score_before REAL DEFAULT 0,
            score_after REAL DEFAULT 0,
            session_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Save database
    saveDatabase();
    console.log('[DB] Database schema validated');
}

// Save database helper
function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    console.log('[IMAGES] Created images directory at', IMAGES_DIR);
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, IMAGES_DIR);
    },
    filename: function (req, file, cb) {
        // Create unique filename: word_timestamp.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        // Accept images only
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Load character list once at startup
let characterList = null;
let characterDataMap = null; // Full data: { [char]: { pinyin, meanings } }

async function loadCharacterList() {
    try {
        const charFile = path.join(__dirname, 'data', 'characters.json');
        const data = JSON.parse(fs.readFileSync(charFile, 'utf8'));
        characterList = Object.keys(data);
        characterDataMap = data;
        console.log('[DATA] Loaded', characterList.length, 'characters');
    } catch (error) {
        console.error('[DATA] Failed to load characters:', error);
        characterList = [];
        characterDataMap = {};
    }
}

// Load Make Me A Hanzi decomposition data
let componentsData = null;
function loadComponentsData() {
    try {
        const f = path.join(__dirname, 'components-data.json');
        componentsData = JSON.parse(fs.readFileSync(f, 'utf8'));
        console.log('[COMPONENTS] Loaded decomposition data for', Object.keys(componentsData).length, 'characters');
    } catch (e) {
        console.error('[COMPONENTS] Failed to load components-data.json:', e.message);
        componentsData = {};
    }
}

function parseCharacters(word) {
    // Split word into individual characters
    return word.split('');
}

function checkCharacterExists(char) {
    return characterList && characterList.includes(char);
}

function determineBaseChars(word) {
    const chars = parseCharacters(word);
    const existingChars = chars.filter(c => checkCharacterExists(c));

    if (existingChars.length > 0) {
        return existingChars;  // Return all existing characters
    } else {
        return [chars[0]];  // Return first character if none exist
    }
}

// Middleware
app.use(express.json({ limit: '10mb' })); // Increased limit for large progress data
app.use(express.static('.'));
app.use('/images', express.static(IMAGES_DIR)); // Serve uploaded images

// CORS middleware for Chrome extension access
app.use(function(req, res, next) {
    // Allow specific origin for credentials (not wildcard)
    const allowedOrigin = req.headers.origin || 'http://192.168.1.222:3000';
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Token, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Sessions live in the app's SQLite DB so logins survive restarts (MemoryStore dropped them all).
// connect-sqlite3 doesn't work on the NAS's Node 12, hence this small store.
class SqlSessionStore extends session.Store {
    get(sid, cb) {
        try {
            const r = db.exec('SELECT data, expires FROM sessions WHERE sid = ?', [sid]);
            if (!r.length || !r[0].values.length) return cb(null, null);
            const row = r[0].values[0];
            if (row[1] < Date.now()) return this.destroy(sid, function() { cb(null, null); });
            cb(null, JSON.parse(row[0]));
        } catch (e) { cb(e); }
    }
    set(sid, sess, cb) {
        try {
            const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
            db.run('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)', [sid, JSON.stringify(sess), expires]);
            saveDatabase();
            if (cb) cb(null);
        } catch (e) { if (cb) cb(e); }
    }
    destroy(sid, cb) {
        try {
            db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
            saveDatabase();
            if (cb) cb(null);
        } catch (e) { if (cb) cb(e); }
    }
}

function initSessions() {
    db.run('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)');
    db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
}

app.use(session({
    store: new SqlSessionStore(),
    secret: 'chinese-word-map-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        sameSite: 'lax', // Works for HTTP; Capacitor app needs different approach
        secure: false // HTTP not HTTPS
    }
}));

// Simple token storage (in-memory, resets on server restart)
const authTokens = new Map(); // token -> { userId, username, expires }

// Generate random token
function generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

// Authentication middleware (supports both sessions and tokens)
function requireAuth(req, res, next) {
    // Check for token in Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const tokenData = authTokens.get(token);

        if (tokenData && tokenData.expires > Date.now()) {
            // Valid token - set user info on request
            req.userId = tokenData.userId;
            req.username = tokenData.username;
            return next();
        }
    }

    // Fall back to session-based auth
    if (req.session.userId) {
        req.userId = req.session.userId;
        req.username = req.session.username;
        return next();
    }

    return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        message: 'Please log in to continue'
    });
}

// Admin authentication middleware (requires user to be logged in AND admin AND not blocked)
function requireAdmin(req, res, next) {
    // First check if user is authenticated
    if (!req.session.userId && !req.userId) {
        return res.status(401).json({
            success: false,
            error: 'Not authenticated',
            message: 'Please log in to continue'
        });
    }

    const userId = req.userId || req.session.userId;

    try {
        const result = db.exec('SELECT is_admin, is_blocked FROM users WHERE id = ?', [userId]);

        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }

        const isAdmin = result[0].values[0][0];
        const isBlocked = result[0].values[0][1];

        if (isBlocked === 1) {
            return res.status(403).json({
                success: false,
                error: 'Account blocked',
                message: 'Your account has been blocked by an administrator'
            });
        }

        if (isAdmin !== 1) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                message: 'Admin access required'
            });
        }

        next();
    } catch (error) {
        console.error('[ADMIN] Auth check error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication check failed'
        });
    }
}

// Check authentication status
app.get('/api/auth/status', function(req, res) {
    let userId = null;

    // Check token first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const tokenData = authTokens.get(token);
        if (tokenData && tokenData.expires > Date.now()) {
            userId = tokenData.userId;
        }
    }

    // Fall back to session
    if (!userId && req.session.userId) {
        userId = req.session.userId;
    }

    if (userId) {
        const result = db.exec('SELECT id, username, email, is_admin, is_blocked FROM users WHERE id = ?', [userId]);

        if (result.length > 0 && result[0].values.length > 0) {
            const row = result[0].values[0];
            const isBlocked = row[4];

            // If user is blocked, return not logged in
            if (isBlocked === 1) {
                return res.json({
                    loggedIn: false,
                    error: 'Account blocked',
                    message: 'Your account has been blocked by an administrator'
                });
            }

            return res.json({
                loggedIn: true,
                username: row[1],
                email: row[2],
                isAdmin: row[3] === 1
            });
        }
    }
    res.json({ loggedIn: false });
});

// Register new user
app.post('/api/auth/register', function(req, res) {
    const { username, password, email } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({
            success: false,
            message: 'Username must be 3-20 characters (letters, numbers, underscore only)'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters'
        });
    }

    try {
        // Check if username exists
        const existing = db.exec('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }

        // Hash password (synchronously for compatibility)
        const password_hash = bcrypt.hashSync(password, 10);

        // Insert user
        db.run('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            [username, password_hash, email || null]);

        saveDatabase();

        console.log('[AUTH] New user registered:', username);

        res.json({
            success: true,
            username: username,
            message: 'Registration successful'
        });

    } catch (error) {
        console.error('[AUTH] Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
});

// Admin registration endpoint (requires secret key)
app.post('/api/auth/register-admin', function(req, res) {
    const { username, password, email, secretKey } = req.body;

    // Secret key check (change this in production!)
    const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'chinese-word-map-admin-secret-2024';

    if (secretKey !== ADMIN_SECRET_KEY) {
        console.log('[ADMIN] Invalid secret key attempt for username:', username);
        return res.status(403).json({
            success: false,
            message: 'Invalid secret key'
        });
    }

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({
            success: false,
            message: 'Username must be 3-20 characters (letters, numbers, underscore only)'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters'
        });
    }

    try {
        // Check if username exists
        const existing = db.exec('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }

        // Hash password
        const password_hash = bcrypt.hashSync(password, 10);

        // Insert admin user
        db.run('INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
            [username, password_hash, email || null, 1]);

        saveDatabase();

        console.log('[ADMIN] New admin user registered:', username);

        res.json({
            success: true,
            username: username,
            message: 'Admin registration successful',
            isAdmin: true
        });

    } catch (error) {
        console.error('[ADMIN] Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Admin registration failed',
            error: error.message
        });
    }
});

// Health check endpoint (for checking if server is reachable)
app.get('/api/health', function(req, res) {
    res.json({ success: true, status: 'ok' });
});

// Login
app.post('/api/auth/login', function(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
    }

    try {
        // Get user (including is_admin field)
        const result = db.exec('SELECT id, username, password_hash, is_admin FROM users WHERE username = ?', [username]);

        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        const row = result[0].values[0];
        const userId = row[0];
        const user = row[1];
        const hash = row[2];
        const isAdmin = row[3] === 1;

        // Verify password (synchronously for compatibility)
        const match = bcrypt.compareSync(password, hash);

        if (!match) {
            return res.status(401).json({
                success: false,
                message: 'Invalid username or password'
            });
        }

        // Update last login
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
        saveDatabase();

        // Create session
        req.session.userId = userId;
        req.session.username = user;

        // Generate token for mobile app (expires in 30 days)
        const token = generateToken();
        const tokenExpires = Date.now() + (30 * 24 * 60 * 60 * 1000);
        authTokens.set(token, {
            userId: userId,
            username: user,
            expires: tokenExpires
        });
        // Persist token so it survives server restarts
        try {
            db.run('INSERT OR REPLACE INTO auth_tokens (token, user_id, username, is_admin, expires, created_at) VALUES (?,?,?,?,?,?)',
                [token, userId, user, isAdmin ? 1 : 0, tokenExpires, Date.now()]);
            saveDatabase();
        } catch(e) {
            console.error('[AUTH] Failed to persist token:', e.message);
        }

        console.log('[AUTH] User logged in:', user);

        res.json({
            success: true,
            username: user,
            isAdmin: isAdmin,
            token: token, // Return token for mobile app
            message: 'Login successful'
        });

    } catch (error) {
        console.error('[AUTH] Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});

// Logout
app.post('/api/auth/logout', function(req, res) {
    const username = req.username;
    req.session.destroy(function(err) {
        if (err) {
            console.error('[AUTH] Logout error:', err);
            return res.status(500).json({
                success: false,
                message: 'Logout failed'
            });
        }
        console.log('[AUTH] User logged out:', username);
        res.json({
            success: true,
            message: 'Logout successful'
        });
    });
});

// Get user progress
app.get('/api/progress', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const result = db.exec('SELECT data FROM progress WHERE user_id = ?', [userId]);

        if (result.length > 0 && result[0].values.length > 0) {
            const progressData = JSON.parse(result[0].values[0][0]);
            console.log('[PROGRESS] Loaded progress for user', req.username);
            res.json(mergePpWords(userId, progressData));
        } else {
            console.log('[PROGRESS] No existing progress for user', req.username);
            res.json(mergePpWords(userId, { compoundProgress: {} }));
        }

    } catch (error) {
        console.error('[PROGRESS] Load error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load progress',
            message: error.message
        });
    }
});

// Save user progress
app.post('/api/progress', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const progressData = req.body;

        if (!progressData || typeof progressData !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Invalid progress data'
            });
        }

        const dataJSON = JSON.stringify(progressData);

        // Check if progress exists
        const existing = db.exec('SELECT user_id FROM progress WHERE user_id = ?', [userId]);

        if (existing.length > 0 && existing[0].values.length > 0) {
            // Update
            db.run('UPDATE progress SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [dataJSON, userId]);
        } else {
            // Insert
            db.run('INSERT INTO progress (user_id, data) VALUES (?, ?)',
                [userId, dataJSON]);
        }

        saveDatabase();

        console.log('[PROGRESS] Saved progress for user', req.username);

        res.json({
            success: true,
            message: 'Progress saved to database'
        });

    } catch (error) {
        console.error('[PROGRESS] Save error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save progress',
            message: error.message
        });
    }
});

// Migrate localStorage data
app.post('/api/migrate', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const { progressData } = req.body;

        if (!progressData) {
            return res.status(400).json({
                success: false,
                error: 'No progress data provided'
            });
        }

        // Check if user already has progress
        const existing = db.exec('SELECT data FROM progress WHERE user_id = ?', [userId]);

        let mergedData = progressData;

        if (existing.length > 0 && existing[0].values.length > 0) {
            const dbData = JSON.parse(existing[0].values[0][0]);
            mergedData = {
                compoundProgress: Object.assign({}, dbData.compoundProgress || {}, progressData.compoundProgress || {})
            };
            console.log('[MIGRATE] Merging localStorage with existing DB data');
        } else {
            console.log('[MIGRATE] Migrating localStorage data');
        }

        const dataJSON = JSON.stringify(mergedData);

        if (existing.length > 0 && existing[0].values.length > 0) {
            db.run('UPDATE progress SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [dataJSON, userId]);
        } else {
            db.run('INSERT INTO progress (user_id, data) VALUES (?, ?)',
                [userId, dataJSON]);
        }

        saveDatabase();

        console.log('[MIGRATE] Migration complete for user', req.username);

        res.json({
            success: true,
            migrated: true,
            message: 'Progress migrated to database'
        });

    } catch (error) {
        console.error('[MIGRATE] Migration error:', error);
        res.status(500).json({
            success: false,
            error: 'Migration failed',
            message: error.message
        });
    }
});

// Translate Chinese text to English using Google Translate
app.post('/api/translate', requireAuth, async function(req, res) {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'No text provided'
        });
    }

    try {
        // Get English translation from Google
        const result = await translate(text, {from: 'zh-CN', to: 'en'});

        // Get pinyin using pinyin-pro (just return the pinyin string with spaces)
        const pinyinText = pinyin(text, { toneType: 'symbol', separator: ' ' });

        console.log('[TRANSLATE] Translated:', text, '->', result.text, '/', pinyinText);

        res.json({
            success: true,
            text: text,
            translation: result.text,
            pronunciation: pinyinText  // Now has actual pinyin!
        });
    } catch (error) {
        console.error('[TRANSLATE] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Translation failed',
            message: error.message
        });
    }
});

// Get user's custom words
app.get('/api/custom-words', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const result = db.exec('SELECT * FROM custom_words WHERE user_id = ? ORDER BY created_at DESC', [userId]);

        const words = [];
        if (result.length > 0 && result[0].values.length > 0) {
            result[0].values.forEach(function(row) {
                words.push({
                    id: row[0],
                    word: row[2],
                    pinyin: row[3],
                    meanings: JSON.parse(row[4]),
                    baseChar: row[5],
                    createdAt: row[6]
                });
            });
        }

        console.log('[CUSTOM WORDS] Loaded', words.length, 'words for user', req.username);

        res.json({ success: true, words: words });
    } catch (error) {
        console.error('[CUSTOM WORDS] Load error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load custom words',
            message: error.message
        });
    }
});

// Get custom words for a specific character
app.get('/api/custom-words/char/:char', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const char = req.params.char;

        // Query where base_char contains the character (handles comma-separated)
        const result = db.exec(
            'SELECT * FROM custom_words WHERE user_id = ? AND base_char LIKE ? ORDER BY created_at DESC',
            [userId, `%${char}%`]
        );

        const words = [];
        if (result.length > 0 && result[0].values.length > 0) {
            result[0].values.forEach(function(row) {
                words.push({
                    id: row[0],
                    word: row[2],
                    pinyin: row[3],
                    meanings: JSON.parse(row[4]),
                    baseChar: row[5]
                });
            });
        }

        res.json({ success: true, words: words });
    } catch (error) {
        console.error('[CUSTOM WORDS] Load by char error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get virtual characters (base chars from custom words that don't exist in main list)
app.get('/api/custom-words/virtual-chars', requireAuth, function(req, res) {
    try {
        const userId = req.userId;

        // Get all custom words for this user
        const result = db.exec('SELECT DISTINCT base_char FROM custom_words WHERE user_id = ?', [userId]);

        const virtualChars = new Set();
        if (result.length > 0 && result[0].values.length > 0) {
            result[0].values.forEach(function(row) {
                const baseChar = row[0]; // base_char field
                if (baseChar) {
                    const chars = baseChar.split(',');
                    chars.forEach(function(char) {
                        const trimmedChar = char.trim();
                        // Only include if NOT in the main character list
                        if (!checkCharacterExists(trimmedChar)) {
                            virtualChars.add(trimmedChar);
                        }
                    });
                }
            });
        }

        // For each virtual character, get its pinyin and first compound's meaning
        const virtualCharData = [];
        virtualChars.forEach(function(char) {
            // Get custom words that have this as base_char
            const wordsResult = db.exec(
                'SELECT word, pinyin, meanings FROM custom_words WHERE user_id = ? AND base_char LIKE ? ORDER BY created_at ASC LIMIT 1',
                [userId, `%${char}%`]
            );

            if (wordsResult.length > 0 && wordsResult[0].values.length > 0) {
                const firstWord = wordsResult[0].values[0];
                const meanings = JSON.parse(firstWord[2]);

                virtualCharData.push({
                    char: char,
                    pinyin: pinyin(char, { toneType: 'symbol' }),
                    meaning: meanings[0] || 'Custom character'
                });
            }
        });

        console.log('[CUSTOM WORDS] Virtual chars:', virtualCharData.length);
        res.json({ success: true, characters: virtualCharData });
    } catch (error) {
        console.error('[CUSTOM WORDS] Get virtual chars error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add custom word
app.post('/api/custom-words', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        let { word, pinyin: pinyinInput, meanings, baseChar } = req.body;

        if (!word || !meanings || meanings.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Word and meanings are required'
            });
        }

        // Auto-detect base characters if not provided
        if (!baseChar) {
            const baseChars = determineBaseChars(word);
            baseChar = baseChars.join(',');  // Store as comma-separated
            console.log('[CUSTOM WORDS] Auto-detected base chars:', baseChar, 'for word:', word);
        }

        // Auto-generate pinyin if not provided
        let pinyinText = pinyinInput;
        if (!pinyinText || pinyinText.trim() === '') {
            pinyinText = pinyin(word, { toneType: 'symbol', separator: ' ' });
            console.log('[CUSTOM WORDS] Auto-generated pinyin:', pinyinText, 'for word:', word);
        }

        const meaningsJSON = JSON.stringify(meanings);

        db.run('INSERT INTO custom_words (user_id, word, pinyin, meanings, base_char) VALUES (?, ?, ?, ?, ?)',
            [userId, word, pinyinText, meaningsJSON, baseChar]);

        saveDatabase();

        console.log('[CUSTOM WORDS] Added:', word, 'for user', req.username);

        res.json({ success: true, message: 'Custom word added', baseChar: baseChar });
    } catch (error) {
        console.error('[CUSTOM WORDS] Add error:', error);

        // Check if it's a duplicate word error
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({
                success: false,
                error: 'You have already added this word'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to add custom word',
            message: error.message
        });
    }
});

// Delete custom word
app.delete('/api/custom-words/:id', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const wordId = req.params.id;

        db.run('DELETE FROM custom_words WHERE id = ? AND user_id = ?', [wordId, userId]);
        saveDatabase();

        console.log('[CUSTOM WORDS] Deleted word ID:', wordId, 'for user', req.username);

        res.json({ success: true, message: 'Custom word deleted' });
    } catch (error) {
        console.error('[CUSTOM WORDS] Delete error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete custom word',
            message: error.message
        });
    }
});

// ============================================
// User Sentences Endpoints
// ============================================

// Get user sentences
app.get('/api/sentences', requireAuth, function(req, res) {
    try {
        const userId = req.userId;

        const stmt = db.prepare('SELECT id, chinese, pinyin, english, created_at FROM user_sentences WHERE user_id = ? ORDER BY created_at DESC');
        stmt.bind([userId]);
        const rows = [];

        while (stmt.step()) {
            const row = stmt.getAsObject();
            rows.push({
                id: row.id,
                chinese: row.chinese,
                pinyin: row.pinyin,
                english: row.english,
                createdAt: row.created_at
            });
        }
        stmt.free();

        console.log('[SENTENCES] Loaded', rows.length, 'sentences for user', req.username);
        res.json({ success: true, sentences: rows });
    } catch (error) {
        console.error('[SENTENCES] Get sentences error:', error);
        res.status(500).json({ success: false, error: 'Failed to load sentences' });
    }
});

// Add new sentence
app.post('/api/sentences', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const { chinese, pinyin, english } = req.body;

        if (!chinese || !pinyin || !english) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }

        const result = db.run(
            'INSERT INTO user_sentences (user_id, chinese, pinyin, english) VALUES (?, ?, ?, ?)',
            [userId, chinese, pinyin, english]
        );

        saveDatabase();

        console.log('[SENTENCES] Added sentence for user', req.username);

        res.json({
            success: true,
            message: 'Sentence added',
            sentence: {
                id: result.lastID,
                chinese: chinese,
                pinyin: pinyin,
                english: english
            }
        });
    } catch (error) {
        console.error('[SENTENCES] Add sentence error:', error);
        res.status(500).json({ success: false, error: 'Failed to add sentence' });
    }
});

// Delete sentence
app.delete('/api/sentences/:id', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const sentenceId = req.params.id;

        db.run('DELETE FROM user_sentences WHERE id = ? AND user_id = ?', [sentenceId, userId]);
        saveDatabase();

        console.log('[SENTENCES] Deleted sentence ID:', sentenceId, 'for user', req.username);

        res.json({ success: true, message: 'Sentence deleted' });
    } catch (error) {
        console.error('[SENTENCES] Delete sentence error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete sentence' });
    }
});

// ============================================
// Admin User Management Endpoints
// ============================================

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, function(req, res) {
    try {
        const usersResult = db.exec(`
            SELECT id, username, email, is_admin, is_blocked, can_edit_definitions, can_upload_images, created_at, last_login
            FROM users
            ORDER BY created_at DESC
        `);

        const users = [];

        if (usersResult.length > 0 && usersResult[0].values.length > 0) {
            usersResult[0].values.forEach(function(row) {
                users.push({
                    id: row[0],
                    username: row[1],
                    email: row[2],
                    isAdmin: row[3] === 1,
                    isBlocked: row[4] === 1,
                    canEditDefinitions: row[5] === 1,
                    canUploadImages: row[6] === 1,
                    createdAt: row[7],
                    lastLogin: row[8]
                });
            });
        }

        console.log('[ADMIN] Retrieved', users.length, 'users');

        res.json({
            success: true,
            users: users,
            total: users.length
        });

    } catch (error) {
        console.error('[ADMIN] Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve users',
            message: error.message
        });
    }
});

// Create new user (admin only)
app.post('/api/admin/users', requireAdmin, function(req, res) {
    const { username, password, email, isAdmin } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({
            success: false,
            message: 'Username must be 3-20 characters (letters, numbers, underscore only)'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters'
        });
    }

    try {
        // Check if username exists
        const existing = db.exec('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0 && existing[0].values.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Username already exists'
            });
        }

        // Hash password
        const password_hash = bcrypt.hashSync(password, 10);

        // Insert user
        db.run('INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
            [username, password_hash, email || null, isAdmin ? 1 : 0]);

        saveDatabase();

        console.log('[ADMIN] Created new user:', username, 'by admin:', req.username);

        res.json({
            success: true,
            username: username,
            message: 'User created successfully'
        });

    } catch (error) {
        console.error('[ADMIN] Create user error:', error);
        res.status(500).json({
            success: false,
            message: 'User creation failed',
            error: error.message
        });
    }
});

// Reset user password (admin only)
app.post('/api/admin/users/:id/reset-password', requireAdmin, function(req, res) {
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters'
        });
    }

    try {
        // Check if user exists
        const userResult = db.exec('SELECT username FROM users WHERE id = ?', [userId]);
        if (userResult.length === 0 || userResult[0].values.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const username = userResult[0].values[0][0];

        // Hash new password
        const password_hash = bcrypt.hashSync(newPassword, 10);

        // Update password
        db.run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, userId]);
        saveDatabase();

        console.log('[ADMIN] Password reset for user:', username, 'by admin:', req.username);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('[ADMIN] Reset password error:', error);
        res.status(500).json({
            success: false,
            error: 'Password reset failed',
            message: error.message
        });
    }
});

// Block/unblock user (admin only)
app.post('/api/admin/users/:id/block', requireAdmin, function(req, res) {
    const userId = parseInt(req.params.id);
    const currentUserId = req.userId || req.session.userId;

    // Prevent admin from blocking themselves
    if (userId === currentUserId) {
        return res.status(400).json({
            success: false,
            error: 'Cannot block your own account'
        });
    }

    try {
        // Get current blocked status
        const userResult = db.exec('SELECT username, is_blocked FROM users WHERE id = ?', [userId]);
        if (userResult.length === 0 || userResult[0].values.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const username = userResult[0].values[0][0];
        const currentBlocked = userResult[0].values[0][1];
        const newBlocked = currentBlocked === 1 ? 0 : 1;

        // Toggle blocked status
        db.run('UPDATE users SET is_blocked = ? WHERE id = ?', [newBlocked, userId]);
        saveDatabase();

        console.log('[ADMIN]', newBlocked ? 'Blocked' : 'Unblocked', 'user:', username, 'by admin:', req.username);

        res.json({
            success: true,
            message: newBlocked ? 'User blocked successfully' : 'User unblocked successfully',
            isBlocked: newBlocked === 1
        });

    } catch (error) {
        console.error('[ADMIN] Block user error:', error);
        res.status(500).json({
            success: false,
            error: 'Block operation failed',
            message: error.message
        });
    }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAdmin, function(req, res) {
    const userId = parseInt(req.params.id);
    const currentUserId = req.userId || req.session.userId;

    // Prevent admin from deleting themselves
    if (userId === currentUserId) {
        return res.status(400).json({
            success: false,
            error: 'Cannot delete your own account'
        });
    }

    try {
        // Check if user exists
        const userResult = db.exec('SELECT username FROM users WHERE id = ?', [userId]);
        if (userResult.length === 0 || userResult[0].values.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const username = userResult[0].values[0][0];

        // Delete user (CASCADE will handle progress and custom_words)
        db.run('DELETE FROM users WHERE id = ?', [userId]);
        saveDatabase();

        console.log('[ADMIN] Deleted user:', username, 'by admin:', req.username);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('[ADMIN] Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'User deletion failed',
            message: error.message
        });
    }
});

// ============================================
// Admin Word Management Endpoints
// ============================================

// Get all custom words from all users (admin only)
app.get('/api/admin/custom-words', requireAdmin, function(req, res) {
    try {
        const { search, userId } = req.query;

        let query = `
            SELECT cw.id, cw.user_id, cw.word, cw.pinyin, cw.meanings, cw.base_char, cw.created_at,
                   u.username
            FROM custom_words cw
            JOIN users u ON cw.user_id = u.id
        `;

        const params = [];
        const conditions = [];

        if (userId) {
            conditions.push('cw.user_id = ?');
            params.push(parseInt(userId));
        }

        if (search) {
            conditions.push('(cw.word LIKE ? OR cw.pinyin LIKE ? OR cw.meanings LIKE ?)');
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY cw.created_at DESC';

        const result = db.exec(query, params);

        const words = [];
        if (result.length > 0 && result[0].values.length > 0) {
            result[0].values.forEach(function(row) {
                words.push({
                    id: row[0],
                    userId: row[1],
                    word: row[2],
                    pinyin: row[3],
                    meanings: JSON.parse(row[4]),
                    baseChar: row[5],
                    createdAt: row[6],
                    username: row[7]
                });
            });
        }

        console.log('[ADMIN] Retrieved', words.length, 'custom words');

        res.json({
            success: true,
            words: words,
            total: words.length
        });

    } catch (error) {
        console.error('[ADMIN] Get custom words error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve custom words',
            message: error.message
        });
    }
});

// Update custom word (admin only)
app.put('/api/admin/custom-words/:id', requireAdmin, function(req, res) {
    const wordId = parseInt(req.params.id);
    const { pinyin, meanings } = req.body;

    if (!meanings || !Array.isArray(meanings) || meanings.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Meanings must be a non-empty array'
        });
    }

    try {
        // Check if word exists
        const wordResult = db.exec('SELECT word FROM custom_words WHERE id = ?', [wordId]);
        if (wordResult.length === 0 || wordResult[0].values.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Custom word not found'
            });
        }

        const word = wordResult[0].values[0][0];
        const meaningsJSON = JSON.stringify(meanings);

        // Update word
        if (pinyin) {
            db.run('UPDATE custom_words SET pinyin = ?, meanings = ? WHERE id = ?',
                [pinyin, meaningsJSON, wordId]);
        } else {
            db.run('UPDATE custom_words SET meanings = ? WHERE id = ?',
                [meaningsJSON, wordId]);
        }

        saveDatabase();

        console.log('[ADMIN] Updated custom word:', word, 'by admin:', req.username);

        res.json({
            success: true,
            message: 'Custom word updated successfully'
        });

    } catch (error) {
        console.error('[ADMIN] Update custom word error:', error);
        res.status(500).json({
            success: false,
            error: 'Custom word update failed',
            message: error.message
        });
    }
});

// Delete custom word (admin only - can delete any user's word)
app.delete('/api/admin/custom-words/:id', requireAdmin, function(req, res) {
    const wordId = parseInt(req.params.id);

    try {
        // Check if word exists
        const wordResult = db.exec('SELECT word, user_id FROM custom_words WHERE id = ?', [wordId]);
        if (wordResult.length === 0 || wordResult[0].values.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Custom word not found'
            });
        }

        const word = wordResult[0].values[0][0];
        const userId = wordResult[0].values[0][1];

        // Delete word
        db.run('DELETE FROM custom_words WHERE id = ?', [wordId]);
        saveDatabase();

        console.log('[ADMIN] Deleted custom word:', word, 'from user ID:', userId, 'by admin:', req.username);

        res.json({
            success: true,
            message: 'Custom word deleted successfully'
        });

    } catch (error) {
        console.error('[ADMIN] Delete custom word error:', error);
        res.status(500).json({
            success: false,
            error: 'Custom word deletion failed',
            message: error.message
        });
    }
});

// ============================================
// Word Edit & Image Upload Endpoints
// ============================================

// Get word edit for a specific word
app.get('/api/word-edits/:word/:wordType', requireAuth, function(req, res) {
    try {
        const word = req.params.word;
        const wordType = req.params.wordType;

        const stmt = db.prepare('SELECT * FROM word_edits WHERE word = ? AND word_type = ?');
        const result = stmt.getAsObject([word, wordType]);
        stmt.free();

        if (result.id) {
            res.json({
                success: true,
                edit: {
                    meanings: JSON.parse(result.edited_meanings),
                    editedAt: result.updated_at
                }
            });
        } else {
            res.json({ success: true, edit: null });
        }
    } catch (error) {
        console.error('[WORD-EDIT] Get edit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save/update word edit
app.post('/api/word-edits', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const { word, wordType, meanings } = req.body;

        // Check if user has permission
        const userStmt = db.prepare('SELECT can_edit_definitions FROM users WHERE id = ?');
        const user = userStmt.getAsObject([userId]);
        userStmt.free();

        if (!user.can_edit_definitions) {
            return res.status(403).json({ success: false, error: 'No permission to edit definitions' });
        }

        // Check if edit exists
        const checkStmt = db.prepare('SELECT id FROM word_edits WHERE word = ? AND word_type = ?');
        const existing = checkStmt.getAsObject([word, wordType]);
        checkStmt.free();

        if (existing.id) {
            // Update existing
            db.run('UPDATE word_edits SET edited_meanings = ?, updated_at = CURRENT_TIMESTAMP WHERE word = ? AND word_type = ?',
                [JSON.stringify(meanings), word, wordType]);
        } else {
            // Insert new
            db.run('INSERT INTO word_edits (word, word_type, edited_meanings, edited_by) VALUES (?, ?, ?, ?)',
                [word, wordType, JSON.stringify(meanings), userId]);
        }

        saveDatabase();
        res.json({ success: true });
    } catch (error) {
        console.error('[WORD-EDIT] Save edit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get word image
app.get('/api/word-images/:word/:wordType', requireAuth, function(req, res) {
    try {
        const word = req.params.word;
        const wordType = req.params.wordType;

        const stmt = db.prepare('SELECT * FROM word_images WHERE word = ? AND word_type = ?');
        const result = stmt.getAsObject([word, wordType]);
        stmt.free();

        if (result.id) {
            res.json({
                success: true,
                image: {
                    filename: result.image_filename,
                    url: `/images/${result.image_filename}`
                }
            });
        } else {
            res.json({ success: true, image: null });
        }
    } catch (error) {
        console.error('[WORD-IMAGE] Get image error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Upload word image
app.post('/api/word-images', requireAuth, upload.single('image'), function(req, res) {
    try {
        const userId = req.userId;
        const { word, wordType } = req.body;

        // Check if user has permission
        const userStmt = db.prepare('SELECT can_upload_images FROM users WHERE id = ?');
        const user = userStmt.getAsObject([userId]);
        userStmt.free();

        if (!user.can_upload_images) {
            // Delete uploaded file
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(403).json({ success: false, error: 'No permission to upload images' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file provided' });
        }

        // Check if image already exists for this word
        const checkStmt = db.prepare('SELECT image_filename FROM word_images WHERE word = ? AND word_type = ?');
        const existing = checkStmt.getAsObject([word, wordType]);
        checkStmt.free();

        if (existing.image_filename) {
            // Delete old image file
            const oldPath = path.join(IMAGES_DIR, existing.image_filename);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
            // Update database
            db.run('UPDATE word_images SET image_filename = ?, uploaded_by = ?, created_at = CURRENT_TIMESTAMP WHERE word = ? AND word_type = ?',
                [req.file.filename, userId, word, wordType]);
        } else {
            // Insert new
            db.run('INSERT INTO word_images (word, word_type, image_filename, uploaded_by) VALUES (?, ?, ?, ?)',
                [word, wordType, req.file.filename, userId]);
        }

        saveDatabase();
        res.json({
            success: true,
            image: {
                filename: req.file.filename,
                url: `/images/${req.file.filename}`
            }
        });
    } catch (error) {
        console.error('[WORD-IMAGE] Upload error:', error);
        // Clean up uploaded file on error
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete word image
app.delete('/api/word-images/:word/:wordType', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const word = req.params.word;
        const wordType = req.params.wordType;

        // Check if user has permission
        const userStmt = db.prepare('SELECT can_upload_images FROM users WHERE id = ?');
        const user = userStmt.getAsObject([userId]);
        userStmt.free();

        if (!user.can_upload_images) {
            return res.status(403).json({ success: false, error: 'No permission to delete images' });
        }

        // Get image filename
        const stmt = db.prepare('SELECT image_filename FROM word_images WHERE word = ? AND word_type = ?');
        const result = stmt.getAsObject([word, wordType]);
        stmt.free();

        if (result.image_filename) {
            // Delete file
            const filePath = path.join(IMAGES_DIR, result.image_filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            // Delete from database
            db.run('DELETE FROM word_images WHERE word = ? AND word_type = ?', [word, wordType]);
            saveDatabase();
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[WORD-IMAGE] Delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update user permissions (admin only)
app.post('/api/admin/users/:id/permissions', requireAdmin, function(req, res) {
    try {
        const userId = req.params.id;
        const { can_edit_definitions, can_upload_images } = req.body;

        db.run('UPDATE users SET can_edit_definitions = ?, can_upload_images = ? WHERE id = ?',
            [can_edit_definitions ? 1 : 0, can_upload_images ? 1 : 0, userId]);

        saveDatabase();
        res.json({ success: true });
    } catch (error) {
        console.error('[ADMIN] Update permissions error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// Chrome Extension Sync Endpoints
// ============================================

// Generate sync token for Chrome extension
app.post('/api/auth/generate-sync-token', requireAuth, function(req, res) {
    try {
        const userId = req.userId;
        const username = req.username;

        // Token expires in 24 hours
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000);

        const tokenData = {
            userId: userId,
            username: username,
            expires: expiresAt,
            timestamp: Date.now()
        };

        // Base64 encode the token
        const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');

        console.log('[SYNC] Generated token for user:', username);

        res.json({
            success: true,
            token: token,
            expiresAt: expiresAt
        });
    } catch (error) {
        console.error('[SYNC] Token generation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate sync token',
            message: error.message
        });
    }
});

// Verify sync token middleware
function verifySyncToken(req, res, next) {
    try {
        const token = req.headers['x-sync-token'];

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'No sync token provided'
            });
        }

        // Decode token
        const tokenData = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));

        // Check expiration
        if (Date.now() > tokenData.expires) {
            return res.status(401).json({
                success: false,
                error: 'Token expired',
                expired: true
            });
        }

        // Attach userId to request
        req.syncUserId = tokenData.userId;
        req.syncUsername = tokenData.username;
        next();
    } catch (error) {
        console.error('[SYNC] Token verification error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid sync token'
        });
    }
}

// Extract known words from progress data
function extractKnownWords(progressData) {
    const knownSet = new Set();

    if (progressData && progressData.compoundProgress) {
        Object.keys(progressData.compoundProgress).forEach(function(char) {
            const charData = progressData.compoundProgress[char];
            if (charData.known && Array.isArray(charData.known)) {
                charData.known.forEach(function(word) {
                    knownSet.add(word);
                });
            }
        });
    }

    return Array.from(knownSet);
}

// POST /api/quiz-history — log a single quiz attempt
app.post('/api/quiz-history', requireAuth, function(req, res) {
    try {
        var userId = req.userId;
        var b = req.body;
        db.run(
            `INSERT INTO quiz_history
             (user_id, word, word_type, quiz_mode, quality, is_correct,
              interval_before, interval_after, easiness_before, easiness_after,
              score_before, score_after, session_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                userId,
                b.word || '',
                b.wordType || 'character',
                b.quizMode || 'pinyin',
                b.quality != null ? b.quality : 0,
                b.isCorrect ? 1 : 0,
                b.intervalBefore || 0,
                b.intervalAfter || 0,
                b.easinessBefore != null ? b.easinessBefore : 2.5,
                b.easinessAfter != null ? b.easinessAfter : 2.5,
                b.scoreBefore || 0,
                b.scoreAfter || 0,
                b.sessionId || null
            ]
        );
        saveDatabase();
        res.json({ success: true });
    } catch (error) {
        console.error('[HISTORY] Log error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/quiz-history — paginated history for the current user
app.get('/api/quiz-history', requireAuth, function(req, res) {
    try {
        var userId = req.userId;
        var limit = Math.min(parseInt(req.query.limit) || 50, 200);
        var offset = parseInt(req.query.offset) || 0;
        var word = req.query.word;
        var mode = req.query.mode;
        var startDate = req.query.startDate ? parseInt(req.query.startDate) : null;
        var endDate = req.query.endDate ? parseInt(req.query.endDate) : null;

        var where = ['user_id = ?'];
        var params = [userId];

        if (word) { where.push('word = ?'); params.push(word); }
        if (mode) { where.push('quiz_mode = ?'); params.push(mode); }
        if (startDate) { where.push("created_at >= datetime(?, 'unixepoch', 'localtime')"); params.push(Math.floor(startDate / 1000)); }
        if (endDate) { where.push("created_at <= datetime(?, 'unixepoch', 'localtime')"); params.push(Math.floor(endDate / 1000)); }

        var whereSQL = 'WHERE ' + where.join(' AND ');

        // Total count
        var countResult = db.exec(
            'SELECT COUNT(*) FROM quiz_history ' + whereSQL,
            params
        );
        var total = (countResult.length > 0 && countResult[0].values.length > 0)
            ? countResult[0].values[0][0]
            : 0;

        // Rows
        var rowResult = db.exec(
            'SELECT id, word, word_type, quiz_mode, quality, is_correct, ' +
            'interval_before, interval_after, easiness_before, easiness_after, ' +
            'score_before, score_after, session_id, ' +
            "(strftime('%s', created_at) * 1000) as createdAt " +
            'FROM quiz_history ' + whereSQL +
            ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [...params, limit, offset]
        );

        var history = [];
        if (rowResult.length > 0) {
            var cols = rowResult[0].columns;
            rowResult[0].values.forEach(function(row) {
                var obj = {};
                cols.forEach(function(col, i) { obj[col] = row[i]; });
                history.push(obj);
            });
        }

        res.json({ success: true, history: history, total: total });
    } catch (error) {
        console.error('[HISTORY] Get error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/quiz-history/export — download history as CSV
app.get('/api/quiz-history/export', requireAuth, function(req, res) {
    try {
        var userId = req.userId;
        var word = req.query.word;
        var mode = req.query.mode;
        var startDate = req.query.startDate ? parseInt(req.query.startDate) : null;
        var endDate = req.query.endDate ? parseInt(req.query.endDate) : null;

        var where = ['user_id = ?'];
        var params = [userId];

        if (word) { where.push('word = ?'); params.push(word); }
        if (mode) { where.push('quiz_mode = ?'); params.push(mode); }
        if (startDate) { where.push("created_at >= datetime(?, 'unixepoch', 'localtime')"); params.push(Math.floor(startDate / 1000)); }
        if (endDate) { where.push("created_at <= datetime(?, 'unixepoch', 'localtime')"); params.push(Math.floor(endDate / 1000)); }

        var whereSQL = 'WHERE ' + where.join(' AND ');

        var rowResult = db.exec(
            'SELECT id, word, word_type, quiz_mode, quality, is_correct, ' +
            'interval_before, interval_after, easiness_before, easiness_after, ' +
            'score_before, score_after, session_id, created_at ' +
            'FROM quiz_history ' + whereSQL +
            ' ORDER BY created_at DESC',
            params
        );

        var rows = [];
        if (rowResult.length > 0) {
            var cols = rowResult[0].columns;
            rowResult[0].values.forEach(function(row) {
                var obj = {};
                cols.forEach(function(col, i) { obj[col] = row[i]; });
                rows.push(obj);
            });
        }

        var csvLines = ['id,word,word_type,quiz_mode,quality,is_correct,interval_before,interval_after,easiness_before,easiness_after,score_before,score_after,session_id,created_at'];
        rows.forEach(function(r) {
            csvLines.push([
                r.id, r.word, r.word_type, r.quiz_mode, r.quality, r.is_correct,
                r.interval_before, r.interval_after,
                r.easiness_before, r.easiness_after,
                r.score_before, r.score_after,
                r.session_id || '', r.created_at
            ].join(','));
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="quiz-history.csv"');
        res.send(csvLines.join('\n'));
    } catch (error) {
        console.error('[HISTORY] Export error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Character decomposition endpoint — returns direct components of a character
app.get('/api/decompose/:char', requireAuth, function(req, res) {
    var char = req.params.char;
    if (!componentsData) {
        return res.json({ success: true, char: char, components: [] });
    }
    var entry = componentsData[char];
    if (!entry || !entry.components || entry.components.length === 0) {
        return res.json({ success: true, char: char, components: [] });
    }
    var components = entry.components.map(function(comp) {
        // Prefer characters.json (app's own data); fall back to Make Me A Hanzi
        var appEntry = characterDataMap && characterDataMap[comp];
        var dictEntry = componentsData[comp];
        return {
            char: comp,
            pinyin: (appEntry && appEntry.pinyin) || (dictEntry && dictEntry.pinyin) || null,
            meaning: (appEntry && appEntry.meanings && appEntry.meanings[0]) || (dictEntry && dictEntry.meaning) || null,
        };
    });
    res.json({ success: true, char: char, components: components });
});

// Export known words for Chrome extension (requires sync token)
app.get('/api/export-known-words', verifySyncToken, function(req, res) {
    try {
        const userId = req.syncUserId;

        // Get user progress
        const result = db.exec('SELECT data FROM progress WHERE user_id = ?', [userId]);

        let knownWords = [];

        if (result.length > 0 && result[0].values.length > 0) {
            const progressData = JSON.parse(result[0].values[0][0]);
            knownWords = extractKnownWords(progressData);
        }

        console.log('[SYNC] Exported', knownWords.length, 'known words for user:', req.syncUsername);

        res.json({
            success: true,
            knownWords: knownWords,
            count: knownWords.length
        });
    } catch (error) {
        console.error('[SYNC] Export error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export known words',
            message: error.message
        });
    }
});

// ============================================
// PhrasePump Subs (YouTube extension) — /api/pp/*
// Kept apart from /api/translate etc. because the extension expects different shapes.
// ============================================
function initPhrasePump() {
    db.run('CREATE TABLE IF NOT EXISTS pp_words (user_id INTEGER NOT NULL, word TEXT NOT NULL, known INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, word))');
}

const HAN_RE = /[㐀-鿿]/;

function ppWordRows(userId) {
    const result = db.exec('SELECT word, known FROM pp_words WHERE user_id = ?', [userId]);
    return result.length ? result[0].values : [];
}

// The extension never writes the progress blob: the app POSTs the whole blob from its own copy and would erase it.
// Instead, extension words are merged in on read, and the app saves them on its next sync.
// shortcut: un-marking in the extension can't remove a word the app has already saved; needs per-word timestamps in progress.
function mergePpWords(userId, progress) {
    progress.characterProgress = progress.characterProgress || {};
    progress.compoundProgress = progress.compoundProgress || {};
    ppWordRows(userId).forEach(function(row) {
        const word = row[0];
        if (row[1] !== 1) return;
        if (word.length === 1) {
            progress.characterProgress[word] = Object.assign({}, progress.characterProgress[word], { known: true });
            return;
        }
        // The app shows a compound under each character whose compound list contains it.
        parseCharacters(word).forEach(function(c) {
            const data = characterDataMap && characterDataMap[c];
            if (!data || !Array.isArray(data.compounds)) return;
            if (!data.compounds.some(function(x) { return x.word === word; })) return;
            const entry = progress.compoundProgress[c] = progress.compoundProgress[c] || { known: [], total: 0, quizScores: {} };
            entry.known = entry.known || [];
            if (entry.known.indexOf(word) === -1) entry.known.push(word);
        });
    });
    return progress;
}

function loadProgress(userId) {
    const result = db.exec('SELECT data FROM progress WHERE user_id = ?', [userId]);
    return result.length && result[0].values.length ? JSON.parse(result[0].values[0][0]) : {};
}

// Known words for subtitle highlighting: app progress + extension marks, extension un-marks win.
app.get('/api/pp/words', requireAuth, function(req, res) {
    try {
        const progress = loadProgress(req.userId);
        const known = new Set(extractKnownWords(progress));
        Object.keys(progress.characterProgress || {}).forEach(function(c) {
            if (progress.characterProgress[c] && progress.characterProgress[c].known) known.add(c);
        });
        const words = {};
        known.forEach(function(w) { words[w] = { status: 'known' }; });
        // Explicit marks (extension or Daily Sentences) win: known, learning, ignored; "unknown" = not marked.
        const r = db.exec('SELECT word, status FROM pp_words WHERE user_id = ?', [req.userId]);
        (r.length ? r[0].values : []).forEach(function(row) {
            if (row[1] === 'unknown' || !row[1]) delete words[row[0]]; else words[row[0]] = { status: row[1] };
        });
        res.json({ words: words });
    } catch (error) {
        console.error('[PP] Words load error:', error);
        res.status(500).json({ error: 'Failed to load words' });
    }
});

app.post('/api/pp/words', requireAuth, function(req, res) {
    const word = typeof req.body.word === 'string' ? req.body.word.trim().slice(0, 50) : '';
    if (!word || !HAN_RE.test(word)) return res.status(400).json({ error: 'Chinese word required' });
    // {status: known|learning|ignored|unknown}; older extension builds send {known: boolean}.
    const status = typeof req.body.known === 'boolean' ? (req.body.known ? 'known' : 'unknown') : req.body.status;
    if (PUMP_STATUSES.indexOf(status) === -1) return res.status(400).json({ error: 'status must be known, learning, ignored or unknown' });
    try {
        const now = Date.now();
        // A word marked learning on YouTube shows up in Daily Sentences straight away.
        db.run('INSERT OR REPLACE INTO pp_words (user_id, word, known, updated_at, status, due) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, word, status === 'known' || status === 'ignored' ? 1 : 0, now, status, status === 'learning' ? now : null]);
        saveDatabase();
        const count = db.exec('SELECT COUNT(*) FROM pp_words WHERE user_id = ? AND known = 1', [req.userId])[0].values[0][0];
        res.json({ word: word, status: status, known: status === 'known', count: count });
    } catch (error) {
        console.error('[PP] Word save error:', error);
        res.status(500).json({ error: 'Failed to save word' });
    }
});

// Subtitle lines repeat a lot; cache to stay under Google's rate limit.
const ppTranslateCache = new Map();
async function ppTranslate(text, to) {
    const key = to + ':' + text;
    if (ppTranslateCache.has(key)) return ppTranslateCache.get(key);
    let out = '';
    try {
        out = (await translate(text, { to: to })).text || '';
    } catch (error) {
        console.error('[PP] Translate error:', error.message);
    }
    if (out) {
        if (ppTranslateCache.size >= 5000) ppTranslateCache.delete(ppTranslateCache.keys().next().value);
        ppTranslateCache.set(key, out);
    }
    return out;
}

app.post('/api/pp/translate', requireAuth, async function(req, res) {
    const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
    const to = req.body.to || 'en';
    if (!text) return res.status(400).json({ error: 'text required' });
    if (to !== 'en' && to !== 'zh-CN') return res.status(400).json({ error: 'to must be en or zh-CN' });
    const out = await ppTranslate(text, to);
    res.json({ text: out, en: to === 'en' ? out : '' });
});

// Saved subtitle lines become the user's own sentences, which the app's sentence practice already reads.
app.post('/api/pp/phrases', requireAuth, async function(req, res) {
    const zh = typeof req.body.zh === 'string' ? req.body.zh.trim().slice(0, 500) : '';
    if (!zh) return res.status(400).json({ error: 'zh required' });
    try {
        const existing = db.exec('SELECT id FROM user_sentences WHERE user_id = ? AND chinese = ?', [req.userId, zh]);
        if (existing.length && existing[0].values.length) return res.json({ created: false });
        let en = typeof req.body.en === 'string' ? req.body.en.trim().slice(0, 1000) : '';
        if (!en) en = await ppTranslate(zh, 'en');
        const py = pinyin(zh, { toneType: 'symbol', nonZh: 'consecutive' }).replace(/\s+([，。！？、；：,.!?;:])/g, '$1');
        // Re-check after the await so two quick saves of one line don't duplicate.
        const dup = db.exec('SELECT id FROM user_sentences WHERE user_id = ? AND chinese = ?', [req.userId, zh]);
        if (dup.length && dup[0].values.length) return res.json({ created: false });
        db.run('INSERT INTO user_sentences (user_id, chinese, pinyin, english) VALUES (?, ?, ?, ?)',
            [req.userId, zh, py, en || '(no translation)']);
        saveDatabase();
        console.log('[PP] Saved phrase for user', req.username);
        res.status(201).json({ created: true });
    } catch (error) {
        console.error('[PP] Phrase save error:', error);
        res.status(500).json({ error: 'Failed to save phrase' });
    }
});

// ============================================
// Daily sentence mode ("pump") — /api/pump/*
// Language-Reactor-style: one target word per sentence, pinyin over each word, tap words to set status.
// Corpus is built offline by chinese-word-map-app/scripts/build-sentence-corpus.mjs (Tatoeba + CC-CEDICT).
// Word status lives in pp_words, shared with the PhrasePump extension (known column = known or ignored).
// ============================================
const PUMP_GOAL = 60;
const PUMP_NEW_PER_DAY = 10;
// Like Language Reactor: a word you don't know gets a few sentences in a row, every day, until you mark it known.
const PUMP_PER_WORD = 3;
const DAY_MS = 86400000;
const PUMP_STATUSES = ['known', 'learning', 'ignored', 'unknown'];
let corpus = { words: {}, s: [] };
const wordIndex = new Map(); // word -> positions in corpus.s, shortest sentence first
const corpusById = new Map();

function loadCorpus() {
    try {
        corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sentence-corpus.json'), 'utf8'));
        corpus.s.forEach(function(s, i) {
            corpusById.set(s[0], s);
            s[3].forEach(function(t) {
                if (!Array.isArray(t)) return;
                const list = wordIndex.get(t[0]) || [];
                if (list[list.length - 1] !== i) list.push(i);
                wordIndex.set(t[0], list);
            });
        });
        wordIndex.forEach(function(list) {
            list.sort(function(a, b) { return corpus.s[a][1].length - corpus.s[b][1].length; });
        });
        console.log('[PUMP] Loaded', corpus.s.length, 'sentences,', wordIndex.size, 'words');
    } catch (error) {
        console.error('[PUMP] Failed to load sentence corpus:', error.message);
    }
}

function initPump() {
    const cols = db.exec('PRAGMA table_info(pp_words)')[0].values.map(function(r) { return r[1]; });
    [['status', 'TEXT'], ['due', 'INTEGER'], ['interval', 'REAL'], ['ease', 'REAL'], ['reps', 'INTEGER'], ['lapses', 'INTEGER'], ['shown_day', 'TEXT']].forEach(function(c) {
        if (cols.indexOf(c[0]) === -1) db.run('ALTER TABLE pp_words ADD COLUMN ' + c[0] + ' ' + c[1]);
    });
    db.run("UPDATE pp_words SET status = CASE known WHEN 1 THEN 'known' ELSE 'unknown' END WHERE status IS NULL");
    db.run('CREATE TABLE IF NOT EXISTS pump_days (user_id INTEGER NOT NULL, day TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, new_words INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))');
    db.run('CREATE TABLE IF NOT EXISTS pump_seen (user_id INTEGER NOT NULL, sentence_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, sentence_id))');
}

// shortcut: the daily count resets at UTC midnight, which is UK midnight in winter and 1am in summer; store a user timezone if that matters.
function pumpToday() { return new Date().toISOString().slice(0, 10); }

function pumpDay(userId) {
    const r = db.exec('SELECT done, new_words FROM pump_days WHERE user_id = ? AND day = ?', [userId, pumpToday()]);
    return r.length && r[0].values.length ? { done: r[0].values[0][0], newWords: r[0].values[0][1] } : { done: 0, newWords: 0 };
}

// Word -> status from ZhongMap progress, overridden by explicit pp_words rows; plus SRS state for learning words.
function userWords(userId) {
    const status = new Map();
    const srs = new Map();
    const progress = loadProgress(userId);
    extractKnownWords(progress).forEach(function(w) { status.set(w, 'known'); });
    Object.keys(progress.characterProgress || {}).forEach(function(c) {
        if (progress.characterProgress[c] && progress.characterProgress[c].known) status.set(c, 'known');
    });
    const r = db.exec('SELECT word, status, due, reps, shown_day FROM pp_words WHERE user_id = ?', [userId]);
    (r.length ? r[0].values : []).forEach(function(row) {
        status.set(row[0], row[1]);
        srs.set(row[0], { due: row[2], reps: row[3], shownDay: row[4] });
    });
    return { status: status, srs: srs };
}

const isKnownish = function(s) { return s === 'known' || s === 'ignored'; };

// The sentence for a target word: few other words you don't know, but long enough to be real reading.
// Score = 4 per unknown word, minus 1 per word (up to 14), plus a big penalty under 10 characters.
function pickSentence(word, status, exclude) {
    const list = wordIndex.get(word) || [];
    let best = null, bestScore = Infinity;
    for (let i = 0; i < list.length && i < 3000; i++) {
        const s = corpus.s[list[i]];
        if (exclude.has(s[0])) continue;
        let unknown = 0, words = 0;
        s[3].forEach(function(t) {
            if (!Array.isArray(t)) return;
            words++;
            if (t[0] !== word && !isKnownish(status.get(t[0]))) unknown++;
        });
        const score = unknown * 4 - Math.min(words, 14) + (s[1].length < 10 ? 20 : 0);
        if (score < bestScore) { best = s; bestScore = score; }
    }
    return best;
}

function pumpCard(s, target, status, kind) {
    return {
        id: s[0], zh: s[1], en: s[2], target: target, kind: kind,
        tokens: s[3].map(function(t) {
            if (!Array.isArray(t)) return { t: t };
            const meta = corpus.words[t[0]];
            return { w: t[0], p: t[1], s: status.get(t[0]) || 'new', m: meta ? meta[1] : '' };
        })
    };
}

// Next batch: due learning words, then up to PUMP_NEW_PER_DAY new words by frequency, then extra practice of learning words.
app.get('/api/pump/next', requireAuth, function(req, res) {
    try {
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const now = Date.now();
        const u = userWords(req.userId);
        const day = pumpDay(req.userId);
        const seenRows = db.exec('SELECT sentence_id FROM pump_seen WHERE user_id = ? AND at > ?', [req.userId, now - 30 * DAY_MS]);
        const exclude = new Set(seenRows.length ? seenRows[0].values.map(function(r) { return r[0]; }) : []);
        const today = pumpToday();
        const cards = [];
        const used = new Set();
        // Adds `times` sentences in a row for one word.
        function add(word, kind, times) {
            if (used.has(word)) return 0;
            used.add(word);
            let added = 0;
            while (added < times && cards.length < limit) {
                const s = pickSentence(word, u.status, exclude);
                if (!s) break;
                exclude.add(s[0]);
                cards.push(pumpCard(s, word, u.status, kind));
                added++;
            }
            return added;
        }
        const shownToday = function(w) { const c = u.srs.get(w); return c && c.shownDay === today ? (c.reps || 0) : 0; };
        const learning = [];
        u.status.forEach(function(st, w) { if (st === 'learning') learning.push(w); });
        learning.sort(function(a, b) { return (u.srs.get(a).due || 0) - (u.srs.get(b).due || 0); });
        learning.filter(function(w) { return (u.srs.get(w).due || 0) <= now; })
            .forEach(function(w) { add(w, 'review', Math.max(1, PUMP_PER_WORD - shownToday(w))); });

        let newLeft = PUMP_NEW_PER_DAY - day.newWords;
        const words = Object.keys(corpus.words); // already in frequency order
        for (let i = 0; i < words.length && newLeft > 0 && cards.length < limit; i++) {
            const st = u.status.get(words[i]);
            if (st && st !== 'unknown') continue;
            // No dictionary entry = segmenter artefact like 我的 or 我想, not a word worth learning.
            if (!corpus.words[words[i]][1]) continue;
            if (add(words[i], 'new', PUMP_PER_WORD)) newLeft--;
        }
        // Daily goal not met and nothing due: one more sentence each for words you're learning.
        if (day.done + cards.length < PUMP_GOAL) learning.forEach(function(w) { add(w, 'extra', 1); });

        res.json({ cards: cards, done: day.done, goal: PUMP_GOAL, newToday: day.newWords, newPerDay: PUMP_NEW_PER_DAY });
    } catch (error) {
        console.error('[PUMP] Next error:', error);
        res.status(500).json({ error: 'Failed to load sentences' });
    }
});

// One POST per card ("Next"): the word statuses tapped on that card, in one DB write.
// The target stays "learning" until you tap it to Known/Ignored; after PUMP_PER_WORD sentences today it waits for tomorrow.
app.post('/api/pump/answer', requireAuth, function(req, res) {
    const body = req.body || {};
    const s = corpusById.get(Number(body.sentenceId));
    const target = typeof body.target === 'string' ? body.target : '';
    const marks = body.words && typeof body.words === 'object' ? body.words : {};
    if (!s || !target) return res.status(400).json({ error: 'sentenceId and target required' });
    try {
        const now = Date.now();
        const today = pumpToday();
        const u = userWords(req.userId);
        const wasNew = !u.status.has(target) || u.status.get(target) === 'unknown';
        function save(word, status, card) {
            db.run('INSERT OR REPLACE INTO pp_words (user_id, word, known, updated_at, status, due, reps, shown_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [req.userId, word, isKnownish(status) ? 1 : 0, now, status, card.due || null, card.reps || null, card.shownDay || null]);
        }
        Object.keys(marks).slice(0, 50).forEach(function(w) {
            if (w === target || w.length > 50 || !HAN_RE.test(w) || PUMP_STATUSES.indexOf(marks[w]) === -1) return;
            const existing = u.srs.get(w);
            save(w, marks[w], marks[w] === 'learning' ? (existing && existing.due ? existing : { due: now }) : {});
        });
        const targetMark = PUMP_STATUSES.indexOf(marks[target]) !== -1 ? marks[target] : 'learning';
        if (targetMark !== 'learning') {
            save(target, targetMark, {});
        } else {
            const card = u.srs.get(target) || {};
            if (body.kind === 'extra' && card.due) {
                // extra sentence for a word already done for today: leave its schedule alone
            } else {
                const shown = (card.shownDay === today ? (card.reps || 0) : 0) + 1;
                save(target, 'learning', { due: shown >= PUMP_PER_WORD ? Date.parse(today) + DAY_MS : now, reps: shown, shownDay: today });
            }
        }
        db.run('INSERT OR REPLACE INTO pump_seen (user_id, sentence_id, at) VALUES (?, ?, ?)', [req.userId, s[0], now]);
        const day = pumpDay(req.userId);
        db.run('INSERT OR REPLACE INTO pump_days (user_id, day, done, new_words) VALUES (?, ?, ?, ?)',
            [req.userId, pumpToday(), day.done + 1, day.newWords + (wasNew ? 1 : 0)]);
        saveDatabase();
        res.json({ done: day.done + 1, goal: PUMP_GOAL, newToday: day.newWords + (wasNew ? 1 : 0) });
    } catch (error) {
        console.error('[PUMP] Answer error:', error);
        res.status(500).json({ error: 'Failed to save answer' });
    }
});

// Hover bubble (extension + Daily Sentences): dictionary meaning from the corpus or the app's word data, else machine translation.
// shortcut: words outside the 18k corpus words and the app's compounds fall back to Google Translate; load all of CC-CEDICT if that's not good enough (costs NAS memory).
function ppMeaning(word) {
    const c = corpus.words[word];
    if (c && c[1]) return c[1];
    const data = characterDataMap || {};
    if (data[word] && data[word].meanings) return data[word].meanings.slice(0, 3).join('; ');
    const chars = parseCharacters(word);
    for (let i = 0; i < chars.length; i++) {
        const compounds = data[chars[i]] && data[chars[i]].compounds;
        const hit = Array.isArray(compounds) && compounds.find(function(x) { return x.word === word; });
        if (hit && hit.meanings) return hit.meanings.slice(0, 3).join('; ');
    }
    return '';
}

app.get('/api/pp/lookup', requireAuth, async function(req, res) {
    const word = typeof req.query.word === 'string' ? req.query.word.trim().slice(0, 20) : '';
    if (!word || !HAN_RE.test(word)) return res.status(400).json({ error: 'Chinese word required' });
    const meaning = ppMeaning(word) || await ppTranslate(word, 'en');
    res.json({ word: word, pinyin: pinyin(word, { toneType: 'symbol' }).replace(/\s+/g, ''), meaning: meaning });
});

// Compat for CharacterDetail / SentencePractice, which call routes from a patch that was never applied.
app.get('/api/sentences/:char', requireAuth, function(req, res) {
    const ch = req.params.char;
    const found = [];
    for (let i = 0; i < corpus.s.length && found.length < 15; i++) {
        const s = corpus.s[i];
        if (s[1].indexOf(ch) !== -1) found.push({
            id: s[0], chinese: s[1], english: s[2],
            pinyin: s[3].map(function(t) { return Array.isArray(t) ? t[1] : t; }).join(' ')
        });
    }
    const data = characterDataMap && characterDataMap[ch];
    res.json({ success: true, senses: [{ senseId: 0, meaning: data && data.meanings ? data.meanings[0] : '', mastery: 0, sentences: found }] });
});

app.post('/api/sentences/practice', requireAuth, function(req, res) {
    res.json({ success: true, mastery: 0 });
});

// Start server
async function start() {
    try {
        await initDatabase();
        initPhrasePump();
        initPump();
        initSessions();
        loadCorpus();
        await loadCharacterList();
        loadComponentsData();

        app.listen(PORT, function() {
            console.log('\n========================================');
            console.log('  Chinese Character Map Server (with Authentication)');
            console.log('========================================');
            console.log('  Server running at: http://localhost:' + PORT);
            console.log('  Database: ' + DB_PATH);
            console.log('  Multi-user support: ENABLED');
            console.log('  Node.js version: ' + process.version);
            console.log('  Press Ctrl+C to stop');
            console.log('========================================\n');
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
