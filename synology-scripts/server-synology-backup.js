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

    // Create sentences table
    db.run(`
        CREATE TABLE IF NOT EXISTS sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            character TEXT NOT NULL,
            sense_id INTEGER NOT NULL DEFAULT 0,
            sense_meaning TEXT,
            chinese TEXT NOT NULL,
            pinyin TEXT,
            english TEXT NOT NULL,
            difficulty INTEGER DEFAULT 1,
            source TEXT DEFAULT 'tatoeba',
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // Create sentence_progress table for per-sense mastery
    db.run(`
        CREATE TABLE IF NOT EXISTS sentence_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            character TEXT NOT NULL,
            sense_id INTEGER NOT NULL DEFAULT 0,
            mastery_level INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0,
            total_attempts INTEGER DEFAULT 0,
            last_practiced INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, character, sense_id)
        )
    `);

    console.log('[DB] Sentences and sentence_progress tables initialized');

    // Save database
    saveDatabase();
    console.log('[DB] Database schema validated');

    // Load sentences after database is initialized
    loadTatoebaSentences();
}

// Save database helper
function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Load sentences from Tatoeba data
function loadTatoebaSentences() {
    const sentencesPath = path.join(__dirname, 'data', 'tatoeba-sentences.json');

    if (!fs.existsSync(sentencesPath)) {
        console.log('[DB] No tatoeba-sentences.json found, skipping sentence import');
        return;
    }

    try {
        const sentencesData = JSON.parse(fs.readFileSync(sentencesPath, 'utf-8'));

        // Check if sentences already loaded
        const count = db.exec('SELECT COUNT(*) as count FROM sentences');
        if (count.length > 0 && count[0][0] > 0) {
            console.log('[DB] Sentences already loaded (' + count[0][0] + ' sentences), skipping import');
            return;
        }

        let totalImported = 0;

        for (const char in sentencesData) {
            const charData = sentencesData[char];

            if (charData.sentences && charData.sentences.length > 0) {
                charData.sentences.forEach((sentence) => {
                    db.run(
                        'INSERT INTO sentences (character, sense_id, chinese, pinyin, english, difficulty) VALUES (?, ?, ?, ?, ?, ?)',
                        [char, 0, sentence.chinese, sentence.pinyin || '', sentence.english, sentence.difficulty || 1]
                    );
                    totalImported++;
                });
            }
        }

        saveDatabase();
        console.log('[DB] Imported ' + totalImported + ' sentences from Tatoeba');
    } catch (error) {
        console.error('[DB] Error loading Tatoeba sentences:', error);
    }
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

async function loadCharacterList() {
    try {
        const charFile = path.join(__dirname, 'data', 'characters.json');
        const data = JSON.parse(fs.readFileSync(charFile, 'utf8'));
        characterList = Object.keys(data);
        console.log('[DATA] Loaded', characterList.length, 'characters');
    } catch (error) {
        console.error('[DATA] Failed to load characters:', error);
        characterList = [];
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
// Request logging for debugging mobile app
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${req.method} ${req.path}`;

    // Log to console (appears in server.log)
    console.log(logEntry);

    // For important API calls, log more details
    if (req.path.startsWith('/api/')) {
        console.log(`  User-Agent: ${req.headers['user-agent']}`);
        if (req.body && Object.keys(req.body).length > 0) {
            // Don't log full progress data (too large), just show it exists
            if (req.body.characterProgress || req.body.compoundProgress) {
                console.log(`  Body: [Progress data - ${JSON.stringify(req.body).length} bytes]`);
            } else {
                console.log(`  Body:`, JSON.stringify(req.body).substring(0, 200));
            }
        }
    }

    next();
});

// Log response status  
app.use((req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
        console.log(`  Response: ${res.statusCode}`);
        originalSend.call(this, data);
    };
    next();
});
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

// Session configuration (using memory store since connect-sqlite3 has issues with old Node)
app.use(session({
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
        // Get user
        const result = db.exec('SELECT id, username, password_hash, is_admin, can_edit_definitions, can_upload_images FROM users WHERE username = ?', [username]);

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
        const isAdmin = row[3] === 1 || row[4] === 1 || row[5] === 1;  // is_admin OR can_edit_definitions OR can_upload_images

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
        authTokens.set(token, {
            userId: userId,
            username: user,
            isAdmin: isAdmin,
            expires: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
        });

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
            res.json(progressData);
        } else {
            console.log('[PROGRESS] No existing progress for user', req.username);
            res.json({ compoundProgress: {} });
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

// ===== SENTENCE PRACTICE API ENDPOINTS =====

// GET /api/sentences/:char - Get sentences for a character
app.get('/api/sentences/:char', requireAuth, function(req, res) {
    try {
        const char = req.params.char;

        // Get all sentences for this character
        const sentences = db.exec(
            'SELECT id, sense_id, sense_meaning, chinese, pinyin, english, difficulty FROM sentences WHERE character = ?',
            [char]
        );

        // Get user's progress for each sense
        const userId = req.session.userId;
        const progress = db.exec(
            'SELECT sense_id, mastery_level, correct_count, total_attempts FROM sentence_progress WHERE user_id = ? AND character = ?',
            [userId, char]
        );

        // Format sentences grouped by sense
        const senseMap = {};

        sentences.forEach(function(row) {
            const id = row[0];
            const senseId = row[1];
            const senseMeaning = row[2];
            const chinese = row[3];
            const pinyin = row[4];
            const english = row[5];
            const difficulty = row[6];

            if (!senseMap[senseId]) {
                senseMap[senseId] = {
                    senseId: senseId,
                    meaning: senseMeaning || 'General usage',
                    sentences: [],
                    mastery: 0,
                    correct: 0,
                    total: 0
                };
            }

            senseMap[senseId].sentences.push({
                id: id,
                chinese: chinese,
                pinyin: pinyin,
                english: english,
                difficulty: difficulty
            });
        });

        // Add progress data
        progress.forEach(function(row) {
            const senseId = row[0];
            const masteryLevel = row[1];
            const correctCount = row[2];
            const totalAttempts = row[3];
            if (senseMap[senseId]) {
                senseMap[senseId].mastery = masteryLevel;
                senseMap[senseId].correct = correctCount;
                senseMap[senseId].total = totalAttempts;
            }
        });

        const senses = Object.keys(senseMap).map(function(key) {
            return senseMap[key];
        });

        res.json({
            success: true,
            character: char,
            senses: senses
        });
    } catch (error) {
        console.error('[API] Get sentences error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/sentences/practice - Record practice session
app.post('/api/sentences/practice', requireAuth, function(req, res) {
    try {
        const character = req.body.character;
        const senseId = req.body.senseId;
        const results = req.body.results;
        // results = [{ sentenceId, correct: true/false }, ...]

        if (!character || senseId === undefined || !results || !Array.isArray(results)) {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        }

        const userId = req.session.userId;

        // Calculate results
        const correctCount = results.filter(function(r) { return r.correct; }).length;
        const totalAttempts = results.length;

        // Get current progress
        const current = db.exec(
            'SELECT correct_count, total_attempts, mastery_level FROM sentence_progress WHERE user_id = ? AND character = ? AND sense_id = ?',
            [userId, character, senseId]
        );

        let newCorrect, newTotal, newMastery;

        if (current.length > 0) {
            // Update existing
            const oldCorrect = current[0][0];
            const oldTotal = current[0][1];
            const oldMastery = current[0][2];
            newCorrect = oldCorrect + correctCount;
            newTotal = oldTotal + totalAttempts;

            // Calculate new mastery (0-5 stars)
            const accuracy = newCorrect / newTotal;
            newMastery = Math.min(5, Math.floor(accuracy * 6)); // 0-5 stars

            db.run(
                'UPDATE sentence_progress SET correct_count = ?, total_attempts = ?, mastery_level = ?, last_practiced = ? WHERE user_id = ? AND character = ? AND sense_id = ?',
                [newCorrect, newTotal, newMastery, Math.floor(Date.now() / 1000), userId, character, senseId]
            );
        } else {
            // Create new
            newCorrect = correctCount;
            newTotal = totalAttempts;
            const accuracy = newCorrect / newTotal;
            newMastery = Math.min(5, Math.floor(accuracy * 6));

            db.run(
                'INSERT INTO sentence_progress (user_id, character, sense_id, correct_count, total_attempts, mastery_level, last_practiced) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, character, senseId, newCorrect, newTotal, newMastery, Math.floor(Date.now() / 1000)]
            );
        }

        saveDatabase();

        res.json({
            success: true,
            mastery: newMastery,
            correct: newCorrect,
            total: newTotal
        });
    } catch (error) {
        console.error('[API] Practice session error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// POST /api/sentences (admin only) - Add custom sentence
app.post('/api/sentences', requireAuth, function(req, res) {
    try {
        const character = req.body.character;
        const senseId = req.body.senseId;
        const senseMeaning = req.body.senseMeaning;
        const chinese = req.body.chinese;
        const pinyin = req.body.pinyin;
        const english = req.body.english;
        const difficulty = req.body.difficulty;

        // Check if user is admin
        const userId = req.session.userId;
        const result = db.exec('SELECT is_admin, can_edit_definitions FROM users WHERE id = ?', [userId]);
        if (!result.length || (result[0][0] !== 1 && result[0][1] !== 1)) {
            return res.status(403).json({ success: false, message: 'Admin permission required' });
        }

        db.run(
            'INSERT INTO sentences (character, sense_id, sense_meaning, chinese, pinyin, english, difficulty, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [character, senseId || 0, senseMeaning || '', chinese, pinyin || '', english, difficulty || 1, 'custom']
        );

        saveDatabase();

        res.json({ success: true, message: 'Sentence added' });
    } catch (error) {
        console.error('[API] Add sentence error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Start server
async function start() {
    try {
        await initDatabase();
        await loadCharacterList();

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
