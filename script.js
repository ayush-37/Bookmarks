document.getElementById("bookForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const bookData = {
    title: form.title.value,
    author: form.author.value,
    rating: form.rating.value,
    review: form.review.value,
    dateRead: form.dateRead.value,
  };

  const response = await fetch("/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookData),
  });

  if (response.ok) {
    form.reset();
    loadBooks();
  }
});

async function loadBooks(sortBy = "date") {
  const res = await fetch(`/books?sort=${sortBy}`);
  const books = await res.json();

  const container = document.getElementById("booksContainer");
  container.innerHTML = "";

  books.forEach((book) => {
    const coverUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn || ''}-M.jpg`;

    const div = document.createElement("div");
    div.className = "book-card";
    div.innerHTML = `
      <img src="${coverUrl}" alt="cover" onerror="this.src='https://via.placeholder.com/100x150'" />
      <div class="info">
        <h3>${book.title}</h3>
        <p><strong>Author:</strong> ${book.author}</p>
        <p><strong>Rating:</strong> ${book.rating}/5</p>
        <p><strong>Review:</strong> ${book.review}</p>
        <p><strong>Date Read:</strong> ${new Date(book.date_read).toLocaleDateString()}</p>
        <button onclick="deleteBook(${book.id})">Delete</button>
      </div>
    `;
    container.appendChild(div);
  });
}

async function deleteBook(id) {
  await fetch(`/books/${id}`, { method: "DELETE" });
  loadBooks();
}

function sortBooks(criteria) {
  loadBooks(criteria);
}

window.onload = loadBooks;
