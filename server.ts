import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import axios from "axios";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Firebase Admin
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }

  app.use(express.json());

  // Middleware to verify Firebase ID Token
  const authenticate = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // Kaggle API Proxy
  app.get("/api/kaggle/datasets", authenticate, async (req: any, res: any) => {
    const { search } = req.query;
    const uid = req.user.uid;

    try {
      const userDoc = await admin.firestore().collection('users').doc(uid).get();
      const userData = userDoc.data();

      if (!userData?.kaggleUsername || !userData?.kaggleApiKey) {
        return res.status(400).json({ error: 'Kaggle credentials not configured' });
      }

      const auth = Buffer.from(`${userData.kaggleUsername}:${userData.kaggleApiKey}`).toString('base64');
      
      const response = await axios.get(`https://www.kaggle.com/api/v1/datasets/list`, {
        params: { search },
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      res.json(response.data);
    } catch (error: any) {
      console.error("Kaggle API Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to fetch datasets' });
    }
  });

  app.post("/api/kaggle/verify", authenticate, async (req: any, res: any) => {
    const { username, apiKey } = req.body;
    
    if (!username || !apiKey) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    try {
      const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
      
      // Try a simple list call to verify
      await axios.get(`https://www.kaggle.com/api/v1/datasets/list`, {
        params: { page: 1, pageSize: 1 },
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Kaggle Verification Error:", error.response?.data || error.message);
      res.status(error.response?.status || 401).json({ 
        success: false, 
        error: error.response?.data?.message || 'Invalid Kaggle credentials' 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
