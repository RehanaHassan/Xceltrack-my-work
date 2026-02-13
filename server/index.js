const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('./firebaseAdmin');
const nodemailer = require('nodemailer');
require('dotenv').config();
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const crypto = require('crypto');

// Import optimization modules
const { logger, requestLogger } = require('./logger');
const { cache, closeRedis } = require('./cache');
const {
    generalLimiter,
    authLimiter,
    otpLimiter,
    uploadLimiter,
    adminLimiter,
    commitLimiter,
} = require('./rateLimiter');
const FileProcessor = require('./fileProcessor');

const app = express();
const port = process.env.PORT || 5000;

// Create HTTP server for Socket.io
const http = require('http');
const server = http.createServer(app);

// Initialize Socket.io
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
    },
});

// Middleware
app.use(helmet()); // Security headers
app.use(cors());
app.use(express.json());
app.use(requestLogger); // HTTP request logging

// Add request ID for tracking
app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    next();
});

// Postgres Configuration with Optimized Connection Pooling
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20, // Maximum number of clients in the pool
    min: 5, // Minimum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Pool event listeners for monitoring
pool.on('connect', () => {
    console.log('New client connected to the pool');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

pool.on('remove', () => {
    console.log('Client removed from pool');
});

// Email Configuration
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
    },
});

// Test DB Connection
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    client.query('SELECT NOW()', (err, result) => {
        release();
        if (err) {
            return console.error('Error executing query', err.stack);
        }
        console.log('Connected to PostgreSQL Database');
    });
});

// Create tables if they don't exist
const createTables = async () => {
    try {
        // OTP Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS otp_verifications (
                email VARCHAR(255) PRIMARY KEY,
                otp_code VARCHAR(6) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL,
                attempts INT DEFAULT 0
            )
        `);
        console.log('OTP table ready');

        // Users Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                firebase_uid VARCHAR(255) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255),
                role VARCHAR(20) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('Users table ready');

        // Workbooks Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS workbooks (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                owner_id VARCHAR(255) NOT NULL, 
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('Workbooks table ready');

        // Worksheets Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS worksheets (
                id SERIAL PRIMARY KEY,
                workbook_id INT REFERENCES workbooks(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                sheet_order INT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('Worksheets table ready');

        // Cells Table (Latest State)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cells (
                id SERIAL PRIMARY KEY,
                worksheet_id INT REFERENCES worksheets(id) ON DELETE CASCADE,
                row_idx INT NOT NULL,
                col_idx INT NOT NULL,
                address VARCHAR(10) NOT NULL,
                value TEXT,
                formula TEXT,
                style JSONB,
                UNIQUE(worksheet_id, row_idx, col_idx)
            )
        `);
        console.log('Cells table ready');

        // Commits Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS commits (
                id SERIAL PRIMARY KEY,
                workbook_id INT REFERENCES workbooks(id) ON DELETE CASCADE,
                user_id VARCHAR(255) NOT NULL,
                message TEXT,
                timestamp TIMESTAMP DEFAULT NOW(),
                hash VARCHAR(64) UNIQUE
            )
        `);
        console.log('Commits table ready');

        // Cell Versions Table (History)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cell_versions (
                id SERIAL PRIMARY KEY,
                commit_id INT REFERENCES commits(id) ON DELETE CASCADE,
                cell_id INT REFERENCES cells(id) ON DELETE CASCADE,
                value TEXT,
                formula TEXT,
                style JSONB
            )
        `);
        console.log('Cell Versions table ready');

        // Create indexes for optimized query performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_workbooks_owner_id ON workbooks(owner_id);
            CREATE INDEX IF NOT EXISTS idx_workbooks_updated_at ON workbooks(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_worksheets_workbook_id ON worksheets(workbook_id);
            CREATE INDEX IF NOT EXISTS idx_cells_worksheet_id ON cells(worksheet_id);
            CREATE INDEX IF NOT EXISTS idx_cells_row_col ON cells(worksheet_id, row_idx, col_idx);
            CREATE INDEX IF NOT EXISTS idx_commits_workbook_id ON commits(workbook_id);
            CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_commits_workbook_timestamp ON commits(workbook_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_cell_versions_commit_id ON cell_versions(commit_id);
            CREATE INDEX IF NOT EXISTS idx_cell_versions_cell_id ON cell_versions(cell_id);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);
        `);
        console.log('Database indexes created successfully');

    } catch (err) {
        console.error('Error creating tables:', err);
    }
};

createTables();

// --- OTP Endpoints ---

// Send OTP
app.post('/api/send-otp', otpLimiter, async (req, res) => {
    const { email, name } = req.body;

    if (!email || !name) {
        return res.status(400).json({ error: 'Email and name are required' });
    }

    try {
        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Delete any existing OTP for this email
        await pool.query('DELETE FROM otp_verifications WHERE email = $1', [email]);

        // Store OTP in database
        await pool.query(
            'INSERT INTO otp_verifications (email, otp_code, expires_at) VALUES ($1, $2, $3)',
            [email, otp, expiresAt]
        );

        // Send email
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'XcelTrack <noreply@xceltrack.com>',
            to: email,
            subject: 'Verify Your XcelTrack Account - OTP Code',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                        .otp-box { background: white; border: 2px solid #3b82f6; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }
                        .otp-code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; }
                        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 5px; }
                        .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Welcome to XcelTrack!</h1>
                        </div>
                        <div class="content">
                            <p>Hi <strong>${name}</strong>,</p>
                            <p>Thank you for signing up! To complete your registration, please verify your email address using the OTP code below:</p>
                            
                            <div class="otp-box">
                                <div style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">Your OTP Code</div>
                                <div class="otp-code">${otp}</div>
                                <div style="color: #6b7280; font-size: 12px; margin-top: 10px;">Valid for 10 minutes</div>
                            </div>

                            <div class="warning">
                                <strong>⚠️ Security Notice:</strong> Never share this code with anyone. XcelTrack will never ask for your OTP via phone or email.
                            </div>

                            <p>If you didn't request this code, please ignore this email.</p>
                            
                            <p>Best regards,<br><strong>The XcelTrack Team</strong></p>
                        </div>
                        <div class="footer">
                            <p>This is an automated message, please do not reply.</p>
                            <p>&copy; 2025 XcelTrack. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await transporter.sendMail(mailOptions);

        console.log(`OTP sent to ${email}: ${otp}`); // For development - remove in production
        res.json({ message: 'OTP sent successfully' });

    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
    }
});

// Verify OTP
app.post('/api/verify-otp', otpLimiter, async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
    }

    try {
        // Get OTP record
        const result = await pool.query(
            'SELECT * FROM otp_verifications WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No OTP found for this email. Please request a new one.' });
        }

        const otpRecord = result.rows[0];

        // Check if OTP has expired
        if (new Date() > new Date(otpRecord.expires_at)) {
            await pool.query('DELETE FROM otp_verifications WHERE email = $1', [email]);
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }

        // Check attempt limit
        if (otpRecord.attempts >= 5) {
            await pool.query('DELETE FROM otp_verifications WHERE email = $1', [email]);
            return res.status(429).json({ error: 'Too many failed attempts. Please request a new OTP.' });
        }

        // Verify OTP
        if (otpRecord.otp_code !== otp) {
            // Increment attempts
            await pool.query(
                'UPDATE otp_verifications SET attempts = attempts + 1 WHERE email = $1',
                [email]
            );
            return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
        }

        // OTP is valid! Delete it from database
        await pool.query('DELETE FROM otp_verifications WHERE email = $1', [email]);

        res.json({ message: 'OTP verified successfully' });

    } catch (error) {
        console.error('Error verifying OTP:', error);
        res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
    }
});

// Sync Endpoint
app.post('/api/sync-user', authLimiter, async (req, res) => {
    const { uid, email, name } = req.body;

    if (!uid || !email || !name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Check cache first
        const cacheKey = cache.userKey(uid);
        const cachedUser = await cache.get(cacheKey);

        if (cachedUser) {
            logger.info('User data retrieved from cache', { uid, email });
            return res.status(200).json({ message: 'User already synced', user: cachedUser });
        }

        // Check if user exists
        const checkRes = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [uid]);

        if (checkRes.rows.length > 0) {
            // Cache the user data
            await cache.set(cacheKey, checkRes.rows[0], 300); // 5 minutes TTL
            logger.info('User already synced', { uid, email });
            return res.status(200).json({ message: 'User already synced', user: checkRes.rows[0] });
        }

        // Insert new user with default 'user' role
        const insertQuery = `
      INSERT INTO users (firebase_uid, email, name, role)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
        const values = [uid, email, name, 'user'];
        const result = await pool.query(insertQuery, values);

        // Cache the new user
        await cache.set(cacheKey, result.rows[0], 300);

        logger.info('User synced successfully', { uid, email, role: result.rows[0].role });
        res.status(201).json({ user: result.rows[0] });

    } catch (error) {
        logger.error('Error syncing user', { error: error.message, uid, email });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get User Role Endpoint
app.get('/api/user-role/:uid', async (req, res) => {
    const { uid } = req.params;

    try {
        // Check cache first
        const cacheKey = cache.userKey(uid);
        const cachedUser = await cache.get(cacheKey);

        if (cachedUser && cachedUser.role) {
            logger.info('User role retrieved from cache', { uid });
            return res.json({ role: cachedUser.role });
        }

        const result = await pool.query('SELECT role FROM users WHERE firebase_uid = $1', [uid]);

        if (result.rows.length === 0) {
            logger.warn('User not found', { uid });
            return res.status(404).json({ error: 'User not found' });
        }

        // Cache the user data
        await cache.set(cacheKey, result.rows[0], 300);

        res.json({ role: result.rows[0].role });
    } catch (error) {
        logger.error('Error fetching user role', { error: error.message, uid });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// --- Workbook & Excel Processing Endpoints ---

// Upload Workbook
app.post('/api/workbooks/upload', uploadLimiter, upload.single('file'), async (req, res) => {
    const { owner_id, owner_name } = req.body;
    const file = req.file;

    if (!file || !owner_id) {
        return res.status(400).json({ error: 'File and owner_id are required' });
    }

    // Validate file
    const fileProcessor = new FileProcessor();
    const validation = fileProcessor.validateFile(file);

    if (!validation.valid) {
        logger.warn('File validation failed', { errors: validation.errors, owner_id });
        return res.status(400).json({ error: validation.errors.join(', ') });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Create Workbook in DB
        const wbResult = await client.query(
            'INSERT INTO workbooks (name, owner_id) VALUES ($1, $2) RETURNING *',
            [file.originalname, owner_id]
        );
        const newWorkbook = wbResult.rows[0];

        // 2. Process Excel file
        logger.info('Processing Excel file', { workbookId: newWorkbook.id, fileName: file.originalname });

        const parsedData = await fileProcessor.processExcelFile(file.buffer, file.originalname);

        // 3. Create Initial Commit
        const hash = crypto.createHash('sha256')
            .update(`${newWorkbook.id}-${owner_id}-${Date.now()}-initial`)
            .digest('hex');

        const commitResult = await client.query(
            'INSERT INTO commits (workbook_id, user_id, message, hash) VALUES ($1, $2, $3, $4) RETURNING *',
            [newWorkbook.id, owner_id, 'Initial Import', hash]
        );
        const initialCommit = commitResult.rows[0];

        // 4. Process Worksheets & Cells
        for (const sheet of parsedData.sheets) {
            // Insert Worksheet
            const wsResult = await client.query(
                'INSERT INTO worksheets (workbook_id, name, sheet_order) VALUES ($1, $2, $3) RETURNING *',
                [newWorkbook.id, sheet.name, sheet.order]
            );
            const newWorksheet = wsResult.rows[0];

            // Insert cells in batches
            if (sheet.cells && sheet.cells.length > 0) {
                await fileProcessor.insertCellsBatch(client, sheet.cells, newWorksheet.id, initialCommit.id);
            }
        }

        await client.query('COMMIT');

        // Invalidate user's workbooks cache
        await cache.del(cache.userWorkbooksKey(owner_id));

        logger.info('Workbook uploaded successfully', {
            workbookId: newWorkbook.id,
            fileName: file.originalname,
            totalCells: parsedData.totalCells,
            owner_id
        });

        res.status(201).json({
            message: 'Workbook uploaded and initialized successfully',
            workbook: newWorkbook,
            stats: {
                totalSheets: parsedData.totalSheets,
                totalCells: parsedData.totalCells,
            },
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error processing upload', { error: error.message, owner_id, fileName: file.originalname });
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Get User's Workbooks
app.get('/api/workbooks', generalLimiter, async (req, res) => {
    const { owner_id } = req.query;
    if (!owner_id) {
        return res.status(400).json({ error: 'owner_id is required' });
    }

    try {
        // Check cache first
        const cacheKey = cache.userWorkbooksKey(owner_id);
        const cachedWorkbooks = await cache.get(cacheKey);

        if (cachedWorkbooks) {
            logger.info('Workbooks retrieved from cache', { owner_id });
            return res.json(cachedWorkbooks);
        }

        const result = await pool.query('SELECT * FROM workbooks WHERE owner_id = $1 ORDER BY updated_at DESC', [owner_id]);

        // Cache the result
        await cache.set(cacheKey, result.rows, 120); // 2 minutes TTL

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching workbooks', { error: error.message, owner_id });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Workbook Data (Full Load for Editor)
app.get('/api/workbooks/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Fetch Workbook
        const wbResult = await pool.query('SELECT * FROM workbooks WHERE id = $1', [id]);
        if (wbResult.rows.length === 0) return res.status(404).json({ error: 'Workbook not found' });
        const workbook = wbResult.rows[0];

        // Fetch Worksheets
        const wsResult = await pool.query('SELECT * FROM worksheets WHERE workbook_id = $1 ORDER BY sheet_order', [id]);
        const worksheets = wsResult.rows;

        const sheetsData = {};
        const sheetOrder = [];

        for (const ws of worksheets) {
            sheetOrder.push(ws.id.toString());

            // Fetch Cells
            const cellsResult = await pool.query('SELECT * FROM cells WHERE worksheet_id = $1', [ws.id]);
            const cells = cellsResult.rows;

            const cellData = {};
            cells.forEach(cell => {
                if (!cellData[cell.row_idx]) cellData[cell.row_idx] = {};

                cellData[cell.row_idx][cell.col_idx] = {
                    v: cell.value,
                    // Map styles back to Univer format if needed (simplified for now)
                };
            });

            sheetsData[ws.id] = {
                id: ws.id.toString(),
                name: ws.name,
                cellData: cellData,
                rowCount: 1000,
                columnCount: 26
            };
        }

        // Construct Univer Data Structure
        const univerData = {
            id: workbook.id.toString(),
            name: workbook.name,
            appVersion: '3.0.0',
            sheets: sheetsData,
            sheetOrder: sheetOrder,
            styles: {} // Styles would need mapping
        };

        res.json(univerData);

    } catch (error) {
        console.error('Error fetching workbook details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Get all users (from Postgres)
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create User (Admin)
app.post('/api/admin/users', adminLimiter, async (req, res) => {
    const { email, password, name, role } = req.body;

    try {
        // 1. Create in Firebase Auth
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: name,
        });

        // 2. Insert into Postgres
        const values = [userRecord.uid, email, name, role || 'user'];
        const result = await pool.query(
            'INSERT INTO users (firebase_uid, email, name, role) VALUES ($1, $2, $3, $4) RETURNING *',
            values
        );

        logger.info('Admin created user successfully', { uid: userRecord.uid, email, role: role || 'user' });
        res.status(201).json({ message: 'User created successfully', user: result.rows[0] });
    } catch (error) {
        logger.error('Error creating user', { error: error.message, email });
        res.status(500).json({ error: error.message });
    }
});

// Update User (Admin)
app.put('/api/admin/users/:uid', adminLimiter, async (req, res) => {
    const { uid } = req.params;
    const { email, name, role } = req.body;

    try {
        // 1. Update Firebase Auth (Best effort)
        try {
            await admin.auth().updateUser(uid, {
                email,
                displayName: name,
            });
        } catch (firebaseError) {
            console.warn('Warning: Failed to update Firebase Auth user:', firebaseError.message);
            // Continue to update DB even if Firebase fails
        }

        // 2. Update Postgres
        const updateQuery = `
      UPDATE users 
      SET email = $1, name = $2, role = $3
      WHERE firebase_uid = $4
      RETURNING *
    `;
        const result = await pool.query(updateQuery, [email, name, role, uid]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found in database' });
        }

        logger.info('Admin updated user successfully', { uid, email });
        res.json({ message: 'User updated successfully', user: result.rows[0] });

    } catch (error) {
        logger.error('Error updating user', { error: error.message, uid });
        res.status(500).json({ error: error.message });
    }
});

// Delete User (Admin)
app.delete('/api/admin/users/:uid', adminLimiter, async (req, res) => {
    const { uid } = req.params;

    try {
        // 1. Delete from Firebase Auth (Best effort)
        try {
            await admin.auth().deleteUser(uid);
        } catch (firebaseError) {
            console.warn('Warning: Failed to delete Firebase Auth user:', firebaseError.message);
            // Continue to delete from DB
        }

        // 2. Delete from Postgres
        const result = await pool.query('DELETE FROM users WHERE firebase_uid = $1 RETURNING *', [uid]);

        if (result.rows.length === 0) {
            console.warn('User deleted from Auth but not found in Postgres');
        }

        logger.info('Admin deleted user successfully', { uid });
        res.json({ message: 'User deleted successfully' });

    } catch (error) {
        logger.error('Error deleting user', { error: error.message, uid });
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// VERSION CONTROL ENDPOINTS
// ============================================

// Create a new commit (snapshot of current workbook state)
app.post('/api/commits', commitLimiter, async (req, res) => {
    const { workbook_id, user_id, message } = req.body;

    if (!workbook_id || !user_id) {
        return res.status(400).json({ error: 'workbook_id and user_id are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Generate commit hash
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256')
            .update(`${workbook_id}-${user_id}-${Date.now()}`)
            .digest('hex');

        // Create commit record
        const commitResult = await client.query(
            `INSERT INTO commits (workbook_id, user_id, message, hash) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [workbook_id, user_id, message || 'Auto-save', hash]
        );
        const commit = commitResult.rows[0];

        // Snapshot all current cells for this workbook
        const cellsResult = await client.query(
            `SELECT c.* FROM cells c
             JOIN worksheets w ON c.worksheet_id = w.id
             WHERE w.workbook_id = $1`,
            [workbook_id]
        );

        // Insert cell versions for this commit
        for (const cell of cellsResult.rows) {
            await client.query(
                `INSERT INTO cell_versions (commit_id, cell_id, value, formula, style)
                 VALUES ($1, $2, $3, $4, $5)`,
                [commit.id, cell.id, cell.value, cell.formula, cell.style]
            );
        }

        await client.query('COMMIT');

        // Invalidate cache
        await cache.delPattern(`commits:${workbook_id}*`);

        logger.info('Commit created successfully', { commitId: commit.id, workbook_id, user_id });
        res.status(201).json({ commit, cells_snapshotted: cellsResult.rows.length });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error creating commit', { error: error.message, workbook_id, user_id });
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// Get commit history for a workbook
app.get('/api/workbooks/:id/commits', generalLimiter, async (req, res) => {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    try {
        const result = await pool.query(
            `SELECT 
                c.id,
                c.message,
                c.user_id,
                c.timestamp,
                c.hash,
                COUNT(cv.id) as changes_count
             FROM commits c
             LEFT JOIN cell_versions cv ON c.id = cv.commit_id
             WHERE c.workbook_id = $1
             GROUP BY c.id
             ORDER BY c.timestamp DESC
             LIMIT $2 OFFSET $3`,
            [id, limit, offset]
        );

        res.json({ commits: result.rows });

    } catch (error) {
        console.error('Error fetching commits:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all commits for a user (Global Activity)
app.get('/api/commits', generalLimiter, async (req, res) => {
    const { user_id, limit = 50, offset = 0 } = req.query;

    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
    }

    try {
        const result = await pool.query(
            `SELECT 
                c.id,
                c.message,
                c.user_id,
                c.timestamp,
                c.hash,
                c.workbook_id,
                w.name as workbook_name,
                COUNT(cv.id) as changes_count
             FROM commits c
             JOIN workbooks w ON c.workbook_id = w.id
             LEFT JOIN cell_versions cv ON c.id = cv.commit_id
             WHERE c.user_id = $1
             GROUP BY c.id, w.name
             ORDER BY c.timestamp DESC
             LIMIT $2 OFFSET $3`,
            [user_id, limit, offset]
        );

        res.json({ commits: result.rows });

    } catch (error) {
        console.error('Error fetching user commits:', error);
        res.status(500).json({ error: error.message });
    }
});


// Get detailed commit information with cell changes
app.get('/api/commits/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Get commit info
        const commitResult = await pool.query(
            'SELECT * FROM commits WHERE id = $1',
            [id]
        );

        if (commitResult.rows.length === 0) {
            return res.status(404).json({ error: 'Commit not found' });
        }

        const commit = commitResult.rows[0];

        // Get all cell versions for this commit with cell metadata
        const changesResult = await pool.query(
            `SELECT 
                cv.*,
                c.address,
                c.row_idx,
                c.col_idx,
                w.name as worksheet_name
             FROM cell_versions cv
             JOIN cells c ON cv.cell_id = c.id
             JOIN worksheets w ON c.worksheet_id = w.id
             WHERE cv.commit_id = $1
             ORDER BY w.sheet_order, c.row_idx, c.col_idx`,
            [id]
        );

        res.json({
            commit,
            changes: changesResult.rows
        });

    } catch (error) {
        console.error('Error fetching commit details:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rollback workbook to a specific commit
app.post('/api/workbooks/:id/rollback', async (req, res) => {
    const { id } = req.params;
    const { commit_id, user_id } = req.body;

    if (!commit_id || !user_id) {
        return res.status(400).json({ error: 'commit_id and user_id are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify commit belongs to this workbook
        const commitCheck = await client.query(
            'SELECT * FROM commits WHERE id = $1 AND workbook_id = $2',
            [commit_id, id]
        );

        if (commitCheck.rows.length === 0) {
            throw new Error('Commit not found or does not belong to this workbook');
        }

        // Get all cell versions from the target commit
        const cellVersions = await client.query(
            `SELECT cv.*, c.id as cell_id, c.worksheet_id
             FROM cell_versions cv
             JOIN cells c ON cv.cell_id = c.id
             WHERE cv.commit_id = $1`,
            [commit_id]
        );

        // Update current cells to match the commit state
        for (const version of cellVersions.rows) {
            await client.query(
                `UPDATE cells 
                 SET value = $1, formula = $2, style = $3
                 WHERE id = $4`,
                [version.value, version.formula, version.style, version.cell_id]
            );
        }

        // Create a new commit for the rollback action
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256')
            .update(`${id}-${user_id}-${Date.now()}-rollback`)
            .digest('hex');

        const newCommitResult = await client.query(
            `INSERT INTO commits (workbook_id, user_id, message, hash)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, user_id, `Rolled back to commit ${commit_id}`, hash]
        );

        // Snapshot the rolled-back state
        for (const version of cellVersions.rows) {
            await client.query(
                `INSERT INTO cell_versions (commit_id, cell_id, value, formula, style)
                 VALUES ($1, $2, $3, $4, $5)`,
                [newCommitResult.rows[0].id, version.cell_id, version.value, version.formula, version.style]
            );
        }

        await client.query('COMMIT');
        res.json({
            message: 'Rollback successful',
            new_commit: newCommitResult.rows[0],
            cells_restored: cellVersions.rows.length
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error during rollback:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

// ============================================
// WEBSOCKET COLLABORATION
// ============================================

// Track active users per workbook
const workbookUsers = new Map(); // workbookId -> Set of { socketId, userId, userName, color }

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join a workbook room
    socket.on('join-workbook', ({ workbookId, userId, userName }) => {
        const room = `workbook-${workbookId}`;
        socket.join(room);

        // Assign a random color for this user's cursor
        const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Store user info
        if (!workbookUsers.has(workbookId)) {
            workbookUsers.set(workbookId, new Set());
        }

        const userInfo = { socketId: socket.id, userId, userName, color };
        workbookUsers.get(workbookId).add(userInfo);

        // Notify others in the room
        socket.to(room).emit('user-joined', userInfo);

        // Send current users to the new joiner
        const currentUsers = Array.from(workbookUsers.get(workbookId) || []);
        socket.emit('current-users', currentUsers);

        console.log(`User ${userName} (${userId}) joined workbook ${workbookId}`);
    });

    // Leave a workbook room
    socket.on('leave-workbook', ({ workbookId, userId }) => {
        const room = `workbook-${workbookId}`;
        socket.leave(room);

        // Remove user from tracking
        if (workbookUsers.has(workbookId)) {
            const users = workbookUsers.get(workbookId);
            const userToRemove = Array.from(users).find(u => u.socketId === socket.id);
            if (userToRemove) {
                users.delete(userToRemove);
                socket.to(room).emit('user-left', { socketId: socket.id, userId });
            }
        }

        console.log(`User ${userId} left workbook ${workbookId}`);
    });

    // Broadcast cursor position
    socket.on('cursor-move', ({ workbookId, position }) => {
        const room = `workbook-${workbookId}`;
        socket.to(room).emit('cursor-update', {
            socketId: socket.id,
            position, // { row, col, worksheetId }
        });
    });

    // Broadcast cell selection
    socket.on('cell-select', ({ workbookId, selection }) => {
        const room = `workbook-${workbookId}`;
        socket.to(room).emit('cell-selection-update', {
            socketId: socket.id,
            selection, // { startRow, startCol, endRow, endCol, worksheetId }
        });
    });

    // Broadcast cell edit
    socket.on('cell-edit', ({ workbookId, cellData }) => {
        const room = `workbook-${workbookId}`;
        socket.to(room).emit('cell-changed', {
            socketId: socket.id,
            cellData, // { row, col, value, formula, worksheetId }
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // Remove from all workbooks
        workbookUsers.forEach((users, workbookId) => {
            const userToRemove = Array.from(users).find(u => u.socketId === socket.id);
            if (userToRemove) {
                users.delete(userToRemove);
                io.to(`workbook-${workbookId}`).emit('user-left', {
                    socketId: socket.id,
                    userId: userToRemove.userId,
                });
            }
        });
    });
});

// ============================================
// START SERVER
// ============================================

server.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    logger.info('WebSocket server ready');
    logger.info('All optimization modules loaded successfully');
});

// Graceful shutdown
const gracefulShutdown = async () => {
    logger.info('Received shutdown signal, closing server gracefully...');

    server.close(() => {
        logger.info('HTTP server closed');
    });

    // Close Socket.io
    io.close(() => {
        logger.info('Socket.io server closed');
    });

    try {
        // Close Redis connection
        await closeRedis();

        // Close database pool
        await pool.end();
        logger.info('Database pool closed');

        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
    }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
