/* ---------- Imports ---------- */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import session from "express-session";
import { Strategy } from "passport-local";



const { Pool } = pg;


/* ---------- Paths ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- Express ---------- */
const app = express();
const PORT = process.env.PORT || 3000;
const saltRounds = 10;

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

/* ---------- Starting a Session ---------- */
app.use(session({
  secret:"AYUSH",
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 *  60 * 24
  }
}));

app.use(passport.initialize());
app.use(passport.session());

/* ---------- Home (hero landing) ---------- */
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "views", "my_site.html"))
);
app.get("/signup", (req,res) =>{
  res.render("sign_up.ejs");
})
app.get("/login", (req,res) =>{
  res.render("signin.ejs");
})

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
    const requestedId = Number(req.params.id);

    // Get the reader
    const reader = (await pool.query("SELECT * FROM readers WHERE id=$1", [requestedId])).rows[0];
    if (!reader) return res.status(404).send("User not found");

    // Get all books for that reader
    const books = (
      await pool.query(
        `SELECT id, title, reviews, google_id,
                CONCAT(
                  'https://books.google.com/books/content?id=',
                  google_id,
                  '&printsec=frontcover&img=1&zoom=1&source=gbs_api'
                ) AS thumbnail
         FROM books
         WHERE reader_id=$1
         ORDER BY reviews DESC`,
        [requestedId]
      )
    ).rows;

    // Determine if the logged-in user owns this page
    const isOwner = req.isAuthenticated() && req.user.id === requestedId;

    res.render("user", { user: { ...reader, books }, isOwner });
  } catch (err) {
    console.error("USER route error:", err);
    res.status(500).send("Database error");
  }
});


// PATCH: Update review
app.patch("/books/:id/review", async (req, res) => {
  try {
    const { review } = req.body;
    const { id } = req.params;
    await pool.query("UPDATE books SET review = $1 WHERE id = $2", [review, id]);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to update review");
  }
});

// DELETE: Remove book
app.delete("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM books WHERE id = $1", [id]);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete book");
  }
});



app.post("/register", async (req,res) =>{
  const newEmail = req.body.email;
  const newPassword = req.body.password;

  try {
    const result = await pool.query("SELECT * FROM readers WHERE email = $1",[newEmail]);
    if(result.rows.length > 0){
      res.send("Email already exists. Try logging in.");
    }
    else{
      bcrypt.hash(newPassword,saltRounds,async (err,hash) =>{
        if(err){
          console.error("Error hashing password:", err);
        }
        else{
          const result = await pool.query("INSERT INTO readers (email,password) VALUES ($1,$2) RETURNING *", [newEmail,hash]);
        }
        const user = result.rows[0];
        const id = user.id;
        req.login(user,(err) =>{
          console.log(err);
          res.redirect(`/users/${id}`);
        })
      });
    }
  } catch (error) {
    console.log(err);
  }
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.redirect("/login");

    req.login(user, (err) => {
      if (err) return next(err);
      return res.redirect(`/users/${user.id}`);
    });
  })(req, res, next);
});
passport.use(new Strategy( { usernameField: 'email' }, async function verify(email,password,cb) {
  try {
    const result = await pool.query("SELECT * FROM readers WHERE email = $1",[email]);
    if (result.rows.length === 0) {
        return cb(null, false, { message: "User not found" });
      } 

    if(result.rows[0].length > 0){
      const user = result.rows[0];
      const storedHashedPassword = user.password;
      bcrypt.compare(password, storedHashedPassword,(err,isTrue) => {
        if(err){
          return cb(err);
        }
        else{
          if(isTrue){
            return cb(null,user);
          }
          else{
            return cb(null,false);
          }
        }
      });
    }
  } catch (error) {
    return cb(error);
  }
}));

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await pool.query("SELECT * FROM readers WHERE id = $1", [id]);
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

/* ---------- Start server ---------- */
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);
