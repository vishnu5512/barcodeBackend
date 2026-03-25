const express = require("express");
const { spawn, exec } = require("child_process");
const path = require("path");

const app = express();
app.use(require("cors")());
app.use(express.json());

const clients = {};
const jobs = {};

// Open local Tkinter dialog directly from the Node server API
app.get('/select-folder', (req, res) => {
    exec('python pick_folder.py', (error, stdout, stderr) => {
        if (error) {
            console.error("Folder selection error:", error);
            res.status(500).json({ error: "Failed to open folder picker" });
            return;
        }
        const folder = stdout.trim();
        res.json({ folderPath: folder });
    });
});

app.get('/progress/:jobId', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    clients[req.params.jobId] = res;
    
    req.on('close', () => {
        delete clients[req.params.jobId];
    });
});

app.post('/start', (req, res) => {
    const { jobId, folderPath, pages } = req.body;
    
    // Spawn python without buffer to get real-time lines printed
    const pythonProcess = spawn('python', ['-u', 'script.py', folderPath, pages || "36"]);
    jobs[jobId] = { process: pythonProcess };

    const streamToClient = (data) => {
        if (clients[jobId]) {
            clients[jobId].write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };

    pythonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('TOTAL:')) {
                const total = parseInt(line.split('TOTAL:')[1].trim());
                streamToClient({ type: 'total', total });
            } else if (line.startsWith('Processed:')) {
                const file = line.split('Processed:')[1].trim();
                streamToClient({ type: 'processed', file });
            } else if (line.startsWith('Report:')) {
                const report = line.split('Report:')[1].trim();
                streamToClient({ type: 'done', report });
            } else if (line.startsWith('STATUS: CANCELLED')) {
                streamToClient({ type: 'cancelled' });
            } else if (line.startsWith('ERROR:')) {
                streamToClient({ type: 'error', message: line });
            }
        }
    });

    pythonProcess.on('close', (code) => {
        delete jobs[jobId];
    });

    res.json({ message: "Started" });
});

app.post('/cancel', (req, res) => {
    const { jobId } = req.body;
    if (jobs[jobId]) {
        // Sends SIGTERM causing python script to die midway
        jobs[jobId].process.kill();
        delete jobs[jobId];
        if (clients[jobId]) {
            clients[jobId].write(`data: ${JSON.stringify({ type: 'cancelled' })}\n\n`);
        }
        res.json({ message: "Cancelled" });
    } else {
        res.status(404).json({ error: "Job not found" });
    }
});

app.listen(5000, () => console.log("🚀 Server running on port 5000"));