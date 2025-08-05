/* ---------- Imports ---------- */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import session from "express-session";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import flash from "connect-flash";
import crypto from "crypto";
import { sendResetLink } from "./utils/sendMail.js";
import dotenv from "dotenv";
dotenv.config();

/* ---------- PostgreSQL ---------- */
const { Pool } = pg;

/* ---------- Paths ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- Express ---------- */
const app = express();
const PORT = process.env.PORT || 3000;
const saltRounds = 10;

// Parse form data and JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ---------- PostgreSQL Connection ---------- */
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

/* ---------- View engine & static ---------- */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Starting a Session ---------- */
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

app.use(flash());

app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});


app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.isAuthenticated = req.isAuthenticated();
  res.locals.currentUser = req.user || null;
  next();
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/my-collection",
  passport.authenticate("google", {
    successRedirect: "/my-collection",
    failureRedirect: "/login",
  })
);


/* ---------- Passport Local Strategy ---------- */
passport.use(
  new Strategy({ usernameField: "email" }, async (email, password, cb) => {
    try {
      const result = await pool.query("SELECT * FROM readers WHERE email = $1", [email]);
      if (result.rows.length === 0) return cb(null, false, { message: "User not found" });

      const user = result.rows[0];
      bcrypt.compare(password, user.password, (err, isValid) => {
        if (err) return cb(err);
        return isValid ? cb(null, user) : cb(null, false, { message: "Invalid password" });
      });
    } catch (error) {
      return cb(error);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/my-collection",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refershToken, profile, cb) => {
      // console.log(profile);
      // console.log(profile.email);
      // console.log(profile.name);
      try {
        console.log(profile.email);
        console.log(profile.name);
        const result = await pool.query("SELECT  * FROM readers WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await pool.query(
            "INSERT INTO readers (name, email, password) VALUES ($1, $2, $3)",
            [profile.name.givenName, profile.email, "google"]
          );
          console.log("\n\n newuser: \n");
          console.log(newUser.rows[0]);
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (error) {
        return cb(error);
      }
    }
  )
);

passport.serializeUser((user, cb) => cb(null, user.id));
passport.deserializeUser(async (id, cb) => {
  try {
    const result = await pool.query("SELECT * FROM readers WHERE id = $1", [id]);
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

app.get("/forgot-password", (req, res) => {
  res.render("forgot_password"); // flash vars already in res.locals
});



app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).send("Email is required.");
  }

  try {
    // 1. Check if email exists in readers table
    const result = await pool.query("SELECT id FROM readers WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(404).send("No account found with this email.");
    }

    const readerId = result.rows[0].id;

    // 2. Generate secure token and expiry
    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 5 min

    // 3. Store in DB
    await pool.query(
      "UPDATE readers SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
      [token, expiry, readerId]
    );

    // 4. Email reset link
    const resetLink = `http://localhost:3000/reset-password/${token}`;
    await sendResetLink(email, resetLink);

    // 5. Success response
    res.render("check_email", { email }); // or redirect to a success EJS page
  } catch (err) {
    console.error("Forgot-password error:", err);
    res.status(500).send("Internal Server Error. Please try again.");
  }
});

app.get("/reset-password/:token", async (req, res) => {
  const { token } = req.params;

  try {
    const client = await pool.connect();

    const result = await client.query(
      "SELECT * FROM readers WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );

    client.release();

    if (result.rows.length === 0) {
      req.flash('error', `Invalid or expired reset link. Please request a new one.`);
      return res.redirect("/forgot-password");
    }


    // Token is valid — render reset form
    res.render("reset_password", { token });

  } catch (err) {
    console.error("Error verifying reset token:", err);
    req.flash('error', `Server error. Please try again.`);
    res.redirect("/forgot-password");
  }
});


app.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    req.flash('error', `Passwords do not match.`);
    return res.redirect(`/reset-password/${token}`);
  }

  try {
    const result = await pool.query(
      "SELECT * FROM readers WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );

    if (result.rows.length === 0) {
      req.flash('error', `Invalid or expired reset link.`);
      return res.redirect("/forgot-password");
    }

    const user = result.rows[0];

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "UPDATE readers SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
      [hashedPassword, user.id]
    );

    // Fetch updated user (only needed fields for session)
    const updatedUser = (await pool.query(
      "SELECT id, name, email FROM readers WHERE id = $1",
      [user.id]
    )).rows[0];

    console.log(updatedUser);
    // Auto-login
    req.login(updatedUser, (err) => {
      if (err) {
        req.flash('error', `Password reset, but auto-login failed. Please log in manually.`);
        return res.redirect("/login");
      }
      req.flash('success', `Your password has been reset successfully!`);
      res.redirect(`/users/${updatedUser.id}`);
    });

  } catch (err) {
    console.error("Error resetting password:", err);
    req.flash('error', "Server error. Please try again.");
    res.redirect("/forgot-password");
  }
});


/* ---------- Authentication Middleware ---------- */
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login"); // Redirect to login if not authenticated
}


/* ---------- Routes ---------- */

// Home
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "views", "my_site.html")));

// Signup & Login
app.get("/signup", (req, res) => {
  console.log("Signup route hit");
  if (!req.isAuthenticated()) {
    return res.render("sign_up.ejs");
  }
  return res.redirect(`/users/${req.user.id}`);
});

app.get("/login", (req, res) => res.render("signin.ejs"));

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    res.redirect("/");
  });
});

/* ---------- Register Route ---------- */
app.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    if (!name || !email || !password || !confirmPassword) {
      return res.redirect("/signup");
    }
    if (password !== confirmPassword) {
      return res.redirect("/signup");
    }

    const existingUser = await pool.query("SELECT * FROM readers WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return res.redirect("/login"); // email already exists
    }

    const hash = await bcrypt.hash(password, saltRounds);
    const result = await pool.query(
      "INSERT INTO readers (name, email, password) VALUES ($1, $2, $3) RETURNING *",
      [name, email, hash]
    );

    const user = result.rows[0];
    req.login(user, (err) => {
      if (err) return next(err);
      res.redirect(`/users/${user.id}`);
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).send("Server error");
  }
});

/* ---------- Login Route ---------- */
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

/* ---------- Explore Page ---------- */
app.get("/explore", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  try {
    const readers = (
      await pool.query("SELECT * FROM readers ORDER BY id LIMIT $1 OFFSET $2", [limit, offset])
    ).rows;

    const users = await Promise.all(
      readers.map(async (r) => {
        const books = (
          await pool.query(
            `SELECT id, title, rating, google_id, review_comment,
                CONCAT('https://books.google.com/books/content?id=', google_id,
                       '&printsec=frontcover&img=1&zoom=1&source=gbs_api') AS thumbnail
             FROM books WHERE reader_id = $1
             ORDER BY rating DESC LIMIT 4`,
            [r.id]
          )
        ).rows;
        return { id: r.id, name: r.name, interests: r.interests, books };
      })
    );

    const totalReaders = Number((await pool.query("SELECT COUNT(*) FROM readers")).rows[0].count);
    const totalPages = Math.ceil(totalReaders / limit);

    res.render("explore", {
      users,
      currentPage: page,
      totalPages,
      isAuthenticated: req.isAuthenticated(),
      currentUser: req.user || null,
    });
  } catch (err) {
    console.error("EXPLORE error:", err);
    res.status(500).send("Server error");
  }
});

// Session-aware redirect for "Manage My Collection"
app.get("/my-collection", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }
  return res.redirect(`/users/${req.user.id}`);
});

/* ---------- User Detail Page ---------- */
app.get("/users/:id", async (req, res) => {
  try {
    const requestedId = Number(req.params.id);
    // if (!req.isAuthenticated()) {
    //   return res.redirect("/");
    // }
    const reader = (await pool.query("SELECT * FROM readers WHERE id=$1", [requestedId])).rows[0];
    if (!reader) return res.status(404).send("User not found");

    const books = (
      await pool.query(
        `SELECT id, title, rating, review_comment, google_id,
                CONCAT('https://books.google.com/books/content?id=', google_id,
                       '&printsec=frontcover&img=1&zoom=1&source=gbs_api') AS thumbnail
         FROM books WHERE reader_id=$1
         ORDER BY rating DESC`,
        [requestedId]
      )
    ).rows;

    const isOwner = req.isAuthenticated() && req.user.id === requestedId;
    res.render("user", {
      user: { ...reader, books },
      isOwner,
      isAuthenticated: req.isAuthenticated(),
      currentUser: req.user || null,
    });
  } catch (err) {
    console.error("USER route error:", err);
    res.status(500).send("Database error");
  }
});

/* ---------- Books CRUD ---------- */

/* ADD BOOK */
app.post("/books/add", ensureAuthenticated, async (req, res) => {
  let { title, google_id, rating, review_comment } = req.body;

  // sanitize rating
  rating = Number(rating);
  if (Number.isNaN(rating) || rating < 0) rating = 0;
  if (rating > 10) rating = 10;

  // enforce word limit
  if (review_comment) {
    const words = review_comment.trim().split(/\s+/);
    if (words.length > 100) {
      review_comment = words.slice(0, 100).join(" ");
    }
  } else {
    review_comment = "";
  }

  try {
    await pool.query(
      `INSERT INTO books (reader_id, title, google_id, rating, review_comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, title, google_id, rating, review_comment]
    );
    req.flash('success', 'Book added successfully!');
    res.redirect(`/users/${req.user.id}`);
  } catch (err) {
    console.error("ADD BOOK error:", err);
    res.status(500).send("Failed to add book.");
  }
});

/* EDIT BOOK */
app.post("/books/:id/edit", ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  let { rating, review_comment } = req.body;

  rating = Number(rating);
  if (Number.isNaN(rating) || rating < 0) rating = 0;
  if (rating > 10) rating = 10;

  if (review_comment) {
    const words = review_comment.trim().split(/\s+/);
    if (words.length > 100) {
      review_comment = words.slice(0, 100).join(" ");
    }
  } else {
    review_comment = "";
  }

  try {
    await pool.query(
      `UPDATE books
          SET rating = $1,
              review_comment = $2
        WHERE id = $3
          AND reader_id = $4`,
      [rating, review_comment, id, req.user.id]
    );
    req.flash('success', `Book's review edited successfully!`);
    res.redirect(`/users/${req.user.id}`);
  } catch (err) {
    console.error("EDIT BOOK error:", err);
    res.status(500).send("Failed to update book.");
  }
});

/* DELETE BOOK */
app.post("/books/:id/delete", ensureAuthenticated, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `DELETE FROM books
        WHERE id = $1
          AND reader_id = $2`,
      [id, req.user.id]
    );
    req.flash("success", "Book deleted successfully.");
    res.redirect(`/users/${req.user.id}`);
  } catch (err) {
    console.error("DELETE BOOK error:", err);
    res.status(500).send("Failed to delete book.");
  }
});


/* Edit Interest */
app.post("/users/:id/interests", async (req, res) => {
  const requestedId = Number(req.params.id);

  if (!req.isAuthenticated() || req.user.id !== requestedId) {
    return res.status(403).send("Unauthorized");
  }

  try {
    // Convert the string to a cleaned-up array
    const raw = req.body.interests || "";
    const cleanedInterests = raw
      .split(",")
      .map((i) => i.trim())
      .filter((i) => i.length > 0);

    await pool.query("UPDATE readers SET interests = $1 WHERE id = $2", [cleanedInterests, requestedId]);

    req.flash("success", "Interests updated successfully.");
    res.redirect(`/users/${requestedId}`);
  } catch (err) {
    console.error("Error updating interests:", err);
    req.flash("error", "Failed to update interests.");
    res.redirect(`/users/${requestedId}`);
  }
});


/* ---------- Start Server ---------- */
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
