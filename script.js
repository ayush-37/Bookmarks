/* ---------- Imports ---------- */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
const { Pool } = pg;

/* ---------- Paths ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- Express ---------- */
const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- PostgreSQL ---------- */
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "book", // ← your DB name
  password: "ayush1537", // ← your password
  port: 5432,
});

/* ---------- View engine & static ---------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Home (hero landing) ---------- */
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "views", "my_site.html"))
);

/* ---------- EXPLORE (all readers) ---------- */
app.get("/explore", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = 5; // readers per page (you can increase this)
  const offset = (page - 1) * limit;

  try {
    // Fetch readers for the current page
    const readers = (
      await pool.query("SELECT * FROM readers ORDER BY id LIMIT $1 OFFSET $2", [
        limit,
        offset,
      ])
    ).rows;

    // Fetch books for each reader
    const users = await Promise.all(
      readers.map(async (r) => {
        const books = (
          await pool.query(
            `SELECT id,
       title,
       reviews,
       google_id,
       review_comment,
       CONCAT(
         'https://books.google.com/books/content?id=',
         google_id,
         '&printsec=frontcover&img=1&zoom=1&source=gbs_api'
       ) AS thumbnail
          FROM books
          WHERE reader_id = $1
          ORDER BY reviews DESC
          LIMIT 4;`,
            [r.id]
          )
        ).rows;

        return { id: r.id, name: r.name, interests: r.interests, books };
      })
    );

    // Get total count for pagination
    const totalReaders = Number((await pool.query("SELECT COUNT(*) FROM readers")).rows[0].count);
const totalPages = Math.ceil(totalReaders / limit);

    res.render("explore", {
      users,
      currentPage: page,
      totalPages,
    });
  } catch (err) {
    console.error("EXPLORE error:", err);
    res.status(500).send("Server error");
  }
});

/* ---------- USER DETAIL ---------- */
app.get("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    /* Reader row */
    const reader = (await pool.query("SELECT * FROM readers WHERE id=$1", [id]))
      .rows[0];
    if (!reader) return res.status(404).send("User not found");

    /* All books for that reader */
    const books = (
      await pool.query(
        `SELECT id,
                title,
                reviews,
                google_id,
                CONCAT(
                  'https://books.google.com/books/content?id=',
                  google_id,
                  '&printsec=frontcover&img=1&zoom=1&source=gbs_api'
                ) AS thumbnail
         FROM books
         WHERE reader_id=$1
         ORDER BY reviews DESC`,
        [id]
      )
    ).rows;

    res.render("user", { user: { ...reader, books } });
  } catch (err) {
    console.error("USER route error:", err);
    res.status(500).send("Database error");
  }
});

/* ---------- Start server ---------- */
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
