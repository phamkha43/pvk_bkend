const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// 🔒 Chỉ cho phép domain playgame.id.vn gọi API
app.use(cors({
  origin: "https://playgame.id.vn"
}));

// Lưu token hợp lệ trong RAM
const validTokens = new Set();

// Đọc file games.json (load 1 lần để nhẹ hơn)
const games = JSON.parse(
  fs.readFileSync(path.join(__dirname, "games.json"), "utf-8")
);

// Sinh token ngẫu nhiên
function generateToken() {
  const token = crypto.randomBytes(8).toString("hex");
  validTokens.add(token);
  // Token hết hạn sau 5 phút
  setTimeout(() => validTokens.delete(token), 5 * 60 * 1000);
  return token;
}

// Serve file tĩnh (thư mục public)
app.use(express.static(path.join(__dirname, "public")));

// API xin token
app.get("/api/token", (req, res) => {
  const token = generateToken();
  res.json({ token });
});

// API lấy danh sách game (yêu cầu token)
app.get("/api/games", (req, res) => {
  const { token } = req.query;
  if (!token || !validTokens.has(token)) {
    return res.status(403).json({ error: "Invalid token" });
  }

  const minimal = games.map(g => ({
    id: g.id,
    title: g.title,
    category: g.category,
    thumbnail: g.thumbnail
  }));
  res.json(minimal);
});

// API chơi game (iframe)
app.get("/play", (req, res) => {
  const { id, token } = req.query;

  if (!token || !validTokens.has(token)) {
    return res.status(403).send("Invalid token");
  }

  const game = games.find(g => g.id === id);
  if (!game) {
    return res.status(404).send("Game not found");
  }

  res.send(`
    <html>
      <head><title>${game.title}</title></head>
      <body style="margin:0">
        <iframe src="${game.iframe}" width="100%" height="100%" style="border:none"></iframe>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
