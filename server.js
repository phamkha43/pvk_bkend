const express = require("express");
const fs = require("fs");
const path = require("path");
const compression = require("compression");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// Nén response -> cực kỳ quan trọng cho Render free
app.use(compression());

// Chỉ cho domain của bạn được truy cập
app.use(
  cors({
    origin: ["https://playgame.id.vn","http://localhost:8080"],
  })
);

// Load games.json vào RAM một lần
const games = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "games.json"), "utf8")
);

// Serve file tĩnh nếu cần (ảnh thumbnail, logo…)
app.use(express.static(path.join(__dirname, "public")));

// Trả về danh sách categories
app.get("/api/categories", (req, res) => {
  const categories = [...new Set(games.map((g) => g.category))];
  res.json(categories);
});

// Trả về danh sách game (full hoặc theo category)
app.get("/api/games", (req, res) => {
  const { category } = req.query;
  let list = games;

  if (category) {
    list = games.filter(
      (g) => g.category.toLowerCase() === category.toLowerCase()
    );
  }

  res.json(
    list.map((g) => ({
      id: g.id,
      title: g.title,
      category: g.category,
      thumb: g.thumb,
      description: g.description || "",
      instructions: g.instructions || "",
      url: g.url,
    }))
  );
});

app.listen(PORT, () => {
  console.log("🚀 Game server running on port " + PORT);
});
