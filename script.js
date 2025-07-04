// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Convert __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (CSS, images)
app.use(express.static(path.join(__dirname, "public")));

// Serve homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "my_site.html"));
});

// Optional: other routes like /add
app.get("/add", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "add.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
