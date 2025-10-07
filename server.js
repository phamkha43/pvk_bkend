const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");

// Hàm slugify để chuẩn hóa title
function slugify(text) {
  if (!text) return "unknown";
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Khởi tạo dotenv
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Cấu hình CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:8080,https://playgame.id.vn").split(",");
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

// Thêm header bảo mật
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self' https://playgame.id.vn http://localhost:8080");
  next();
});

// Cấu hình rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 100, // 100 yêu cầu mỗi IP
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

// Lưu token hợp lệ và URL proxy tạm thời
const validTokens = new Set();
const proxyUrls = new Map();

// Đọc games.json
let games;
try {
  games = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "games.json"), "utf-8"));
  console.log(`Loaded ${games.length} games from games.json`);
} catch (err) {
  console.error("Error loading games.json:", err);
  process.exit(1);
}

// Hàm sinh token
function generateToken() {
  const token = crypto.randomBytes(16).toString("hex");
  validTokens.add(token);
  setTimeout(() => validTokens.delete(token), 5 * 60 * 1000); // Hết hạn sau 5 phút
  return token;
}

// Middleware kiểm tra token
function checkToken(req, res, next) {
  const token = req.headers.authorization?.split("Bearer ")[1] || req.query.token;
  if (!token || !validTokens.has(token)) {
    console.error(`Invalid or expired token: ${token}`);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
  next();
}

// Serve file tĩnh
app.use(express.static(path.join(__dirname, "public")));

// API xin token
app.get("/api/token", (req, res) => {
  const token = generateToken();
  console.log(`Generated token: ${token}`);
  res.json({ token });
});

// API lấy danh sách category
app.get("/api/categories", checkToken, (req, res) => {
  try {
    const categories = [...new Set(games.map((g) => g.category))];
    res.json(categories);
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// API lấy danh sách game
app.get("/api/games", checkToken, (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    let filtered = games;

    if (category) {
      filtered = games.filter((g) => g.category.toLowerCase() === category.toLowerCase());
    }

    const start = (page - 1) * limit;
    const end = start + parseInt(limit);
    const paginated = filtered.slice(start, end);

    const minimal = paginated.map((g) => ({
      id: slugify(g.title),
      title: g.title,
      category: g.category,
      thumb: g.thumb,
      description: g.description || "",
      instructions: g.instructions || "",
    }));

    res.json({
      games: minimal,
      total: filtered.length,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error("Error fetching games:", err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

// API chơi game (iframe)
app.get("/play", checkToken, (req, res) => {
  try {
    const { id } = req.query;
    const game = games.find((g) => slugify(g.title) === id);

    if (!game) {
      console.error(`Game not found for title slug: ${id}`);
      return res.status(404).send("Game not found");
    }

    console.log(`Serving /play for game title slug: ${id}, title: ${game.title}`);
    res.send(`
      <!DOCTYPE html>
      <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${game.title}</title>
        </head>
        <body style="margin:0">
          <iframe id="gameIframe" width="${game.width || "100%"}" height="${game.height || "100%"}" style="border:none"></iframe>
          <script>
            window.addEventListener('DOMContentLoaded', async function() {
              const iframe = document.getElementById('gameIframe');
              if (!iframe) {
                console.error('Error: gameIframe not found');
                return;
              }
              const gameId = '${slugify(game.title)}';
              console.log('Game ID:', gameId);
              try {
                const tokenResponse = await fetch('/api/token', {
                  headers: { 'Accept': 'application/json' }
                });
                if (!tokenResponse.ok) throw new Error('Failed to get token: HTTP ' + tokenResponse.status);
                const tokenData = await tokenResponse.json();
                const token = tokenData.token;
                console.log('Received token:', token);
                const proxyResponse = await fetch('/api/proxy?id=${encodeURIComponent(id)}', {
                  headers: {
                    'Authorization': 'Bearer ' + token,
                    'Accept': 'application/json'
                  }
                });
                if (!proxyResponse.ok) throw new Error('Proxy failed: HTTP ' + proxyResponse.status);
                const proxyData = await proxyResponse.json();
                console.log('Proxy response:', proxyData);
                const urlResponse = await fetch(proxyData.url, {
                  headers: { 'Accept': 'application/json' }
                });
                if (!urlResponse.ok) throw new Error('Failed to get original URL: HTTP ' + urlResponse.status);
                const urlData = await urlResponse.json();
                console.log('Original URL:', urlData.url);
                iframe.src = urlData.url;
                console.log('Set iframe src:', urlData.url);
              } catch (error) {
                console.error('Error loading game:', error);
                iframe.parentElement.innerHTML = '<p>Lỗi khi tải game: ' + error.message + '</p>';
              }
            });
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Error serving game:", err);
    res.status(500).send("Failed to load game");
  }
});

// API dịch
const GEMINI_KEYS = Object.keys(process.env)
  .filter((k) => k.startsWith("KEY"))
  .map((k) => process.env[k]);

function getNextKey() {
  const randomIndex = Math.floor(Math.random() * GEMINI_KEYS.length);
  return GEMINI_KEYS[randomIndex];
}

async function translateTextGemini(text, targetLanguage = "vi", maxRetries = 3) {
  if (!text) return "";
  const validLanguages = ["vi", "en", "fr", "es", "de"];
  if (!validLanguages.includes(targetLanguage)) {
    console.warn(`Invalid target language: ${targetLanguage}, falling back to 'vi'`);
    targetLanguage = "vi";
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const prompt = `Translate the following text to ${targetLanguage}, keeping the labels "DESC:" and "INSTR:" unchanged and only translating the content after these labels:\n\n${text}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const currentKey = getNextKey();
      const res = await fetch(`${url}?key=${currentKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!translatedText) {
        throw new Error("No translation returned from Gemini API");
      }
      return translatedText;
    } catch (err) {
      console.error(`Translate error (attempt ${attempt}): ${err.message}`);
      if (attempt === maxRetries) {
        console.error("Max retries reached, returning original text");
        return text;
      }
      const wait = Math.pow(2, attempt) + Math.random();
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }
  return text;
}

app.get("/api/translate", checkToken, async (req, res) => {
  const { text, lang } = req.query;
  if (!text) return res.status(400).json({ error: "Missing text" });

  try {
    const translated = await translateTextGemini(text, lang || "vi");
    let translatedDesc = "";
    let translatedInstr = "";

    const parts = translated.split(/(?:\n|\r\n|\r)?INSTR:/);
    if (parts.length > 1) {
      translatedDesc = parts[0].replace(/^DESC:/, "").trim();
      translatedInstr = parts[1].trim();
    } else {
      translatedDesc = translated.replace(/^DESC:/, "").trim();
      translatedInstr = "";
    }

    res.json({
      translated: {
        description: translatedDesc,
        instructions: translatedInstr,
      },
    });
  } catch (err) {
    console.error("Translate API error:", err);
    res.status(500).json({ error: "Translation failed", details: err.message });
  }
});

// Proxy để trả về URL gốc
app.get("/api/proxy", checkToken, async (req, res) => {
  const { id } = req.query;
  console.log(`Yêu cầu proxy cho slug game: ${id}`);
  const game = games.find((g) => slugify(g.title) === id);
  if (!game) {
    console.error(`Không tìm thấy game cho slug: ${id}`);
    return res.status(404).json({ error: "Không tìm thấy game" });
  }

  const url = game.url;
  console.log(`Tìm thấy URL game: ${url}`);
  if (!url) {
    console.error(`URL không hợp lệ: ${url}`);
    return res.status(400).json({ error: "URL không hợp lệ", details: "Không có URL được cung cấp cho game" });
  }

  try {
    // Tạo token tạm thời và lưu URL gốc
    const tempToken = crypto.randomBytes(16).toString("hex");
    proxyUrls.set(tempToken, url);
    setTimeout(() => proxyUrls.delete(tempToken), 15 * 60 * 1000); // Hết hạn sau 15 phút
    // Sử dụng domain công khai từ biến môi trường hoặc mặc định là Render URL
    const backendUrl = process.env.BACKEND_URL || 'https://pvk-bkend.onrender.com';
    const proxyUrl = `${backendUrl}/proxy/${tempToken}`;
    console.log(`Tạo URL proxy: ${proxyUrl}`);
    res.json({ url: proxyUrl });
  } catch (err) {
    console.error(`Lỗi proxy cho ${url}: ${err.message}`);
    res.status(500).json({ error: "Proxy thất bại", details: err.message });
  }
});

// Endpoint proxy trả về URL gốc
app.get("/proxy/:token", async (req, res) => {
  const { token } = req.params;
  if (!/^[a-f0-9]{32}$/.test(token)) {
    console.error(`Invalid proxy token format: ${token}`);
    return res.status(400).send("Invalid proxy token format");
  }
  const originalUrl = proxyUrls.get(token);
  if (!originalUrl) {
    console.error(`Invalid or expired proxy token: ${token}`);
    return res.status(404).send("Invalid or expired proxy token");
  }

  console.log(`Serving original URL for token: ${token}, URL: ${originalUrl}`);
  res.json({ url: originalUrl });
});

// Middleware xử lý lỗi chung
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});