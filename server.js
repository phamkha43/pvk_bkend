const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// 🔒 Cấu hình CORS
// Production chỉ cho domain chính thức, localhost cho test
app.use(cors({
  origin: "https://playgame.id.vn"
}));

// Lưu token hợp lệ trong RAM
const validTokens = new Set();

// Load games.json 1 lần duy nhất
const games = JSON.parse(
  fs.readFileSync(path.join(__dirname, "games.json"), "utf-8")
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
  const categories = [...new Set(games.map(g => g.category))];
  res.json(categories);
});

// API lấy danh sách game (menu con hoặc tất cả)
app.get("/api/games", checkToken, (req, res) => {
  const { category } = req.query;
  let filtered = games;

  if (category) {
    filtered = games.filter(
      g => g.category.toLowerCase() === category.toLowerCase()
    );
  }

  const minimal = filtered.map(g => ({
    id: g.id,
    title: g.title,
    category: g.category,
    thumbnail: g.thumbnail,
    description: g.description || "",
    instructions: g.instructions || ""
  }));

  res.json(minimal);
});

// API chơi game (iframe)
app.get("/play", checkToken, (req, res) => {
  const { id } = req.query;
  const game = games.find(g => g.id === id);

  if (!game) {
    return res.status(404).send("Game not found");
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>${game.title}</title>
        ${game.script ? `<script src="${game.script}" charset="UTF-8"></script>` : ""}
      </head>
      <body style="margin:0">
        <iframe src="${game.iframe}" width="100%" height="100%" style="border:none"></iframe>
      </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});


