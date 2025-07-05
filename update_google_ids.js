import pg from "pg";
import fetch from "node-fetch"; // use npm i node-fetch@2 for ESM compatibility

const { Pool } = pg;

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "book",
  password: "ayush1537",
  port: 5432,
});

async function fetchGoogleBookId(title) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(title)}`
    );
    const data = await response.json();
    if (data.items && data.items.length > 0) {
      return data.items[0].id;
    }
    return null;
  } catch (err) {
    console.error("API error for title:", title, err.message);
    return null;
  }
}

async function updateBooksWithGoogleIds() {
  try {
    const books = await pool.query("SELECT id, title FROM books WHERE google_id IS NULL");

    for (const book of books.rows) {
      const googleId = await fetchGoogleBookId(book.title);
      if (googleId) {
        await pool.query(
          "UPDATE books SET google_id = $1 WHERE id = $2",
          [googleId, book.id]
        );
        console.log(`✅ Updated book "${book.title}" with ID: ${googleId}`);
      } else {
        console.log(`⚠️  No Google ID found for "${book.title}"`);
      }
    }

    console.log("🎉 All done.");
    process.exit();
  } catch (err) {
    console.error("Error updating books:", err);
    process.exit(1);
  }
}

updateBooksWithGoogleIds();
