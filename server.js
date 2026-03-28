const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(require("cors")());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ status: "alive", message: "Barcode Backend is running!" });
});

const clients = {};
const jobs = {};

// Local Picker endpoint
app.get('/local-pick', (req, res) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const picker = spawn(pythonCmd, ['pick_folder.py']);
    let folderPath = "";

    picker.stdout.on('data', (data) => {
        folderPath += data.toString();
    });

    picker.on('close', (code) => {
        const finalPath = folderPath.trim();
        if (finalPath) {
            res.json({ folderPath: finalPath });
        } else {
            res.status(400).json({ error: "No folder selected" });
        }
    });
});

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
    const { jobId, pages, localPath } = req.body;
    const folderPath = localPath || path.join(__dirname, "uploads", jobId);
    
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const pythonProcess = spawn(pythonCmd, ['-u', 'script.py', folderPath, pages || "36"]);
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
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0) {
            streamToClient({ type: 'error', message: `Python script failed with code ${code}` });
        }
        
        // Cleanup: Delete uploads folder if it's not a local path
        if (!localPath && fs.existsSync(folderPath)) {
            setTimeout(() => {
                try {
                    fs.rmSync(folderPath, { recursive: true, force: true });
                    console.log(`Deleted temporary folder: ${folderPath}`);
                } catch (err) {
                    console.error(`Failed to delete folder ${folderPath}:`, err);
                }
            }, 5000); // Wait 5s to ensure file handles are closed
        }

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));