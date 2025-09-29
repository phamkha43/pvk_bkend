const express = require("express");
const fs = require("fs"); // Import fs đầy đủ
const fsPromises = require("fs").promises; // Import fs.promises riêng
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const JSONStream = require("JSONStream");
const { createReadStream } = require("fs");

const app = express();
const PORT = process.env.PORT || 8080;

// 🔒 Cấu hình CORS
app.use(
  cors({
    origin: ["http://localhost:8080", "https://playgame.id.vn"],
  })
);

// Lưu token hợp lệ trong RAM
const validTokens = new Set();

// Cache danh sách game trong RAM
let cachedGames = null;

// Đọc và gộp tất cả file .json trong thư mục data (dùng stream)
async function loadGames() {
  if (cachedGames) {
    console.log("✅ Lấy games từ cache");
    return cachedGames;
  }

  let games = [];
  try {
    const dataDir = path.join(__dirname, "data");
    const files = await fsPromises.readdir(dataDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(dataDir, file);
        const stream = createReadStream(filePath, { encoding: "utf-8" });
        const parser = JSONStream.parse('*'); // Parse từng phần tử trong mảng
        let fileGames = [];

        await new Promise((resolve, reject) => {
          stream.pipe(parser)
            .on('data', data => fileGames.push(data))
            .on('end', resolve)
            .on('error', reject);
        });

        games = games.concat(fileGames);
        console.log(`✅ Đã đọc ${fileGames.length} game từ file ${file}`);
      } catch (err) {
        console.error(`Lỗi khi đọc file ${file}:`, err.message);
      }
    }
    console.log(`✅ Tổng cộng đọc ${games.length} game từ ${jsonFiles.length} file .json`);
    cachedGames = games; // Lưu vào cache
    return games;
  } catch (err) {
    console.error("Lỗi khi quét thư mục data:", err.message);
    return [];
  }
}

// Hàm sinh token
function generateToken() {
  const token = crypto.randomBytes(8).toString("hex");
  validTokens.add(token);
  // Token hết hạn sau 5 phút
  setTimeout(() => validTokens.delete(token), 5 * 60 * 1000);
  return token;
}

// Middleware kiểm tra token
function checkToken(req, res, next) {
  const { token } = req.query;
  if (!token || !validTokens.has(token)) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
  next();
}

// Serve file tĩnh (public/)
app.use(express.static(path.join(__dirname, "public")));

// API xin token
app.get("/api/token", (req, res) => {
  const token = generateToken();
  res.json({ token });
});

// API lấy danh sách category (menu tổng)
app.get("/api/categories", checkToken, async (req, res) => {
  try {
    const games = await loadGames();
    if (games.length === 0) {
      return res.status(500).json({ error: "Không đọc được dữ liệu game" });
    }
    const categories = [...new Set(games.map((g) => g.category).filter(c => c))];
    res.json(categories);
  } catch (err) {
    console.error("Lỗi API /api/categories:", err.message);
    res.status(500).json({ error: "Lỗi khi lấy danh sách category", details: err.message });
  }
});

// API lấy danh sách game (menu con hoặc tất cả)
app.get("/api/games", checkToken, async (req, res) => {
  const { category } = req.query;
  try {
    const games = await loadGames();
    if (games.length === 0) {
      return res.status(500).json({ error: "Không đọc được dữ liệu game" });
    }

    let filtered = games;
    if (category) {
      filtered = games.filter(
        (g) => g.category && g.category.toLowerCase() === category.toLowerCase()
      );
    }

    // Chỉ trả về thông tin cần thiết
    const minimal = filtered.map((g) => ({
      id: g.id,
      title: g.title,
      category: g.category || "",
      thumb: g.thumb || "",
      description: g.description || "",
      instructions: g.instructions || ""
    }));

    res.json(minimal);
  } catch (err) {
    console.error("Lỗi API /api/games:", err.message);
    res.status(500).json({ error: "Lỗi khi lấy danh sách game", details: err.message });
  }
});

// API chơi game (iframe)
app.get("/play", checkToken, async (req, res) => {
  const { id } = req.query;
  try {
    const games = await loadGames();
    if (games.length === 0) {
      return res.status(500).json({ error: "Không đọc được dữ liệu game" });
    }

    const game = games.find((g) => g.id === id);
    if (!game) {
      return res.status(404).send("Game not found");
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="vi">
        <head>
          <meta charset="UTF-8">
          <title>${game.title}</title>
        </head>
        <body style="margin:0">
          <iframe src="${game.url}" width="${game.width || "100%"}" height="${
      game.height || "100%"
    }" style="border:none"></iframe>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Lỗi API /play:", err.message);
    res.status(500).json({ error: "Lỗi khi tải game", details: err.message });
  }
});

// API dịch văn bản
const GEMINI_KEYS = fs
  .readFileSync(path.join(__dirname, "data", "keys.dat"), "utf-8")
  .split("\n")
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

function getNextKey() {
  const randomIndex = Math.floor(Math.random() * GEMINI_KEYS.length);
  return GEMINI_KEYS[randomIndex];
}

async function translateTextGemini(text, targetLanguage = "vi", maxRetries = 2) {
  if (!text) return "";

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const prompt = `Translate the following text to ${targetLanguage}, keeping the labels "DESC:" and "INSTR:" unchanged and only translating the content after these labels:\n\n${text}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const currentKey = getNextKey();
    try {
      const res = await fetch(`${url}?key=${currentKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const translated = data.candidates?.[0]?.content?.parts?.[0]?.text || text;
      return translated;
    } catch (err) {
      const wait = Math.pow(2, attempt) + Math.random();
      console.error(`[Translate Debug] Lỗi: ${err.message}, đợi ${wait.toFixed(1)}s trước khi thử lại...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }

  console.warn("[Translate Debug] Không thể dịch, trả về nguyên văn.");
  return text;
}

app.get("/api/translate", checkToken, async (req, res) => {
  const { text, lang } = req.query;
  if (!text) return res.status(400).json({ error: "Missing text" });

  try {
    console.log('Input text to translate:', text);
    const translated = await translateTextGemini(text, lang || "vi");
    let translatedDesc = '';
    let translatedInstr = '';
    
    const parts = translated.split(/(?:\n|\r\n|\r)?INSTR:/);
    if (parts.length > 1) {
      translatedDesc = parts[0].replace(/^DESC:/, '').trim();
      translatedInstr = parts[1].trim();
    } else {
      translatedDesc = translated.replace(/^DESC:/, '').trim();
      translatedInstr = '';
    }

    res.json({ 
      translated: {
        description: translatedDesc,
        instructions: translatedInstr
      }
    });
  } catch (err) {
    console.error("Translate API error:", err.message, err.stack);
    res.status(500).json({ error: "Translation failed", details: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});