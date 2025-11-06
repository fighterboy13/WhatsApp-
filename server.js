const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const clients = new Map();
const activeTasks = new Map();

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'WhatsApp Auto Sender API is running',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/generate-pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ 
            success: false,
            error: 'Phone number is required' 
        });
    }

    try {
        const pairingCode = Math.random().toString(36).substring(2, 10).toUpperCase();
        const formattedCode = pairingCode.substring(0, 4) + '-' + pairingCode.substring(4, 8);

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: `client-${phoneNumber}-${Date.now()}`
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        client.on('ready', () => {
            console.log(`Client ready: ${phoneNumber}`);
        });

        client.on('authenticated', () => {
            console.log(`Authenticated: ${phoneNumber}`);
        });

        client.on('disconnected', () => {
            clients.delete(phoneNumber);
        });

        await client.initialize();
        clients.set(phoneNumber, client);

        res.json({
            success: true,
            pairingCode: formattedCode,
            sessionId: phoneNumber,
            message: 'Session created successfully'
        });

    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate pairing code',
            details: error.message
        });
    }
});

app.post('/api/send-message', async (req, res) => {
    const { sessionId, number, message } = req.body;

    if (!sessionId || !number || !message) {
        return res.status(400).json({ 
            success: false,
            error: 'Missing required fields' 
        });
    }

    const client = clients.get(sessionId);
    if (!client) {
        return res.status(404).json({ 
            success: false,
            error: 'Session not found' 
        });
    }

    try {
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, message);

        res.json({
            success: true,
            message: 'Message sent successfully',
            to: number
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to send message',
            details: error.message
        });
    }
});

app.post('/api/send-bulk', async (req, res) => {
    const { sessionId, numbers, message, delay = 5 } = req.body;

    if (!sessionId || !numbers || !message) {
        return res.status(400).json({ 
            success: false,
            error: 'Missing required fields' 
        });
    }

    const client = clients.get(sessionId);
    if (!client) {
        return res.status(404).json({ 
            success: false,
            error: 'Session not found' 
        });
    }

    const taskId = `TASK-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    
    setImmediate(async () => {
        const taskData = {
            status: 'running',
            total: numbers.length,
            sent: 0,
            failed: 0,
            logs: []
        };

        activeTasks.set(taskId, taskData);

        for (let i = 0; i < numbers.length; i++) {
            const task = activeTasks.get(taskId);
            
            if (task.status === 'stopped') break;

            const number = numbers[i];
            
            try {
                const chatId = number.includes('@') ? number : `${number}@c.us`;
                await client.sendMessage(chatId, message);
                task.sent++;
                task.logs.push(`✓ Sent to ${number}`);
            } catch (error) {
                task.failed++;
                task.logs.push(`✗ Failed: ${number}`);
            }

            activeTasks.set(taskId, task);

            if (i < numbers.length - 1 && task.status !== 'stopped') {
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
        }

        const task = activeTasks.get(taskId);
        task.status = task.status === 'stopped' ? 'stopped' : 'completed';
        activeTasks.set(taskId, task);
    });

    res.json({
        success: true,
        taskId: taskId,
        total: numbers.length
    });
});

app.get('/api/task-status/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    
    if (!task) {
        return res.status(404).json({ 
            success: false,
            error: 'Task not found' 
        });
    }

    res.json({
        success: true,
        task: task
    });
});

app.post('/api/stop-task', (req, res) => {
    const { taskId } = req.body;
    const task = activeTasks.get(taskId);

    if (!task) {
        return res.status(404).json({ 
            success: false,
            error: 'Task not found' 
        });
    }

    task.status = 'stopped';
    activeTasks.set(taskId, task);

    res.json({
        success: true,
        message: 'Task stopped'
    });
});

app.get('/api/stats', (req, res) => {
    const runningTasks = Array.from(activeTasks.values()).filter(t => t.status === 'running').length;
    
    res.json({
        success: true,
        activeSessions: clients.size,
        activeTasks: runningTasks
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    for (const [phoneNumber, client] of clients.entries()) {
        try {
            await client.destroy();
        } catch (error) {
            console.error(`Error closing ${phoneNumber}:`, error);
        }
    }
    process.exit(0);
});
