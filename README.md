# 🎵 Find Any Song by Its Lyrics

> A Node.js + Express app that helps users find YouTube music videos by typing any part of a song's lyrics — even fuzzy or slightly incorrect ones — using Genius lyrics search and YouTube video matching.

---

## 🌟 Features

- 🔍 Search songs by partial or fuzzy lyrics
- 🎬 Auto-displays YouTube video next to full lyrics
- 🎨 Clean UI with dark mode support
- 📜 Genius API integration for accurate lyrics
- ⚙️ Built with Express, EJS, and Cheerio

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/lyrics-finder.git
cd lyrics-finder
````

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root folder:

```env
GENIUS_ACCESS_TOKEN=your_genius_api_key_here
```

### 4. Run the app

```bash
node index.js
```

Visit: [http://localhost:3000](http://localhost:3000)

---

## 🔐 Environment Variables

| Variable              | Description                     |
| --------------------- | ------------------------------- |
| `GENIUS_ACCESS_TOKEN` | Required for Genius API access  |


---

## 🧠 Tech Stack

* **Backend**: Node.js, Express.js
* **Templating**: EJS
* **Scraping**: Cheerio
* **Styling**: CSS (with dark mode support)
* **APIs**: Genius API, YouTube search (no API key)

---

## 📁 Project Structure

```
├── public/            # CSS & static files
├── views/             # EJS templates
├── index.js           # Main Express app
├── .env               # API keys (not committed)
├── .gitignore
├── package.json
```


