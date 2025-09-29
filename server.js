const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// 🔒 Cấu hình CORS
// Production: chỉ cho phép domain chính thức, + localhost cho test
app.use(
  cors({
    origin: ["http://localhost:8080", "https://playgame.id.vn"],
  })
);

// Lưu token hợp lệ trong RAM
const validTokens = new Set();

// Load games.json 1 lần duy nhất
const games = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "games.json"), "utf-8")
);

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
app.get("/api/categories", checkToken, (req, res) => {
  const categories = [...new Set(games.map((g) => g.category))];
  res.json(categories);
});

// API lấy danh sách game (menu con hoặc tất cả)
app.get("/api/games", checkToken, (req, res) => {
  const { category } = req.query;
  let filtered = games;

  if (category) {
    filtered = games.filter(
      (g) => g.category.toLowerCase() === category.toLowerCase()
    );
  }

  // chỉ trả về thông tin cần thiết
  const minimal = filtered.map((g) => ({
    id: g.id,
    title: g.title,
    category: g.category,
    thumb: g.thumb, // ✅ games.json có trường thumb
    description: g.description || "",
    instructions: g.instructions || "",
  }));

  res.json(minimal);
});

// API chơi game (iframe)
app.get("/play", checkToken, (req, res) => {
  const { id } = req.query;
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
});

const GEMINI_KEYS = fs
  .readFileSync(path.join(__dirname, "data", "keys.dat"), "utf-8")
  .split("\n")
  .map((k) => k.trim())
  .filter((k) => k.length > 0);

function getNextKey() {
  // Chọn ngẫu nhiên một key từ danh sách
  const randomIndex = Math.floor(Math.random() * GEMINI_KEYS.length);
  return GEMINI_KEYS[randomIndex];
}

// Hàm dịch sang tiếng Việt (có retry + backoff)
async function translateTextGemini(text, targetLanguage = "vi", maxRetries = 2) {
  if (!text) return "";

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const prompt = `Translate the following text to ${targetLanguage}, keeping the labels "DESC:" and "INSTR:" unchanged and only translating the content after these labels:\n\n${text}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const currentKey = getNextKey();
    //console.log(`\n[Translate Debug] Thử lần ${attempt} với key: ${currentKey.slice(0, 8)}...`);
    //console.log("Prompt gửi đi:\n", prompt);

    try {
      const res = await fetch(`${url}?key=${currentKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      //console.log("Status code:", res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      //console.log("JSON trả về từ API:\n", JSON.stringify(data, null, 2));

      const translated = data.candidates?.[0]?.content?.parts?.[0]?.text || text;
      //console.log("Text dịch nhận được:\n", translated);
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
    //console.log('Raw translated text:', JSON.stringify(translated));

    // Tách chuỗi linh hoạt, hỗ trợ \nINSTR: hoặc INSTR: trực tiếp
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

    //console.log('Parsed translation:', { description: translatedDesc, instructions: translatedInstr });
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
