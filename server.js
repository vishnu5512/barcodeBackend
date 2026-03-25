const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(require("cors")());
app.use(express.json());

const clients = {};
const jobs = {};

// Use Multer to Upload files from Vercel Frontend to Render Backend
app.post('/upload', (req, res, next) => {
    const jobId = Date.now().toString();
    req.uploadDir = path.join(__dirname, "uploads", jobId);
    fs.mkdirSync(req.uploadDir, { recursive: true });
    
    const storage = multer.diskStorage({
        destination: (req_in_cb, file, cb) => cb(null, req.uploadDir),
        filename: (req_in_cb, file, cb) => cb(null, path.basename(file.originalname))
    });
    
    const upload = multer({ storage }).array("files");
    
    upload(req, res, (err) => {
        if (err) return res.status(500).json({ error: "Upload failed" });
        res.json({ jobId, totalFiles: req.files.length });
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
    const { jobId, pages } = req.body;
    const folderPath = path.join(__dirname, "uploads", jobId);
    
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

app.get('/download/:jobId', (req, res) => {
    const folderPath = path.join(__dirname, "uploads", req.params.jobId);
    fs.readdir(folderPath, (err, files) => {
        if (err) return res.status(404).send("Folder not found");
        const csvFile = files.find(f => f.endsWith('.csv'));
        if (csvFile) {
            res.download(path.join(folderPath, csvFile));
        } else {
            res.status(404).send("Report not generated");
        }
    });
});

app.listen(5000, () => console.log("🚀 Server running on port 5000"));