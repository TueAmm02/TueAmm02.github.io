const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = new Database(path.join(__dirname, 'comments.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_school_id ON comments(school_id);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load schools from JSON file
let schools = [];
try {
  const data = fs.readFileSync(path.join(__dirname, 'public', 'data', 'schools.json'), 'utf8');
  schools = JSON.parse(data);
} catch (e) {
  console.error('Kunne ikke indlæse schools.json:', e.message);
}

// GET /api/schools
app.get('/api/schools', (req, res) => {
  res.json(schools);
});

// GET /api/schools/:id
app.get('/api/schools/:id', (req, res) => {
  const school = schools.find(s => s.id === req.params.id);
  if (!school) return res.status(404).json({ error: 'Skole ikke fundet' });
  res.json(school);
});

// GET /api/comments/:schoolId
app.get('/api/comments/:schoolId', (req, res) => {
  const comments = db
    .prepare('SELECT * FROM comments WHERE school_id = ? ORDER BY created_at DESC')
    .all(req.params.schoolId);
  res.json(comments);
});

// GET /api/stats – aggregated rating per school
app.get('/api/stats', (req, res) => {
  const stats = db
    .prepare(`
      SELECT school_id,
             COUNT(*) as count,
             ROUND(AVG(rating), 1) as avg_rating
      FROM comments
      GROUP BY school_id
    `)
    .all();
  const map = {};
  stats.forEach(s => { map[s.school_id] = s; });
  res.json(map);
});

// POST /api/comments/:schoolId
app.post('/api/comments/:schoolId', (req, res) => {
  const { author, rating, comment } = req.body;
  const schoolId = req.params.schoolId;

  if (!schools.find(s => s.id === schoolId)) {
    return res.status(404).json({ error: 'Skole ikke fundet' });
  }
  if (!author || typeof author !== 'string' || author.trim().length < 2) {
    return res.status(400).json({ error: 'Navn skal være mindst 2 tegn' });
  }
  if (!rating || !Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Vurdering skal være mellem 1 og 5' });
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length < 5) {
    return res.status(400).json({ error: 'Kommentar skal være mindst 5 tegn' });
  }
  if (comment.length > 1000) {
    return res.status(400).json({ error: 'Kommentar må maksimalt være 1000 tegn' });
  }

  const stmt = db.prepare(
    'INSERT INTO comments (school_id, author, rating, comment) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(
    schoolId,
    author.trim().substring(0, 100),
    parseInt(rating),
    comment.trim().substring(0, 1000)
  );
  const newComment = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(newComment);
});

app.listen(PORT, () => {
  console.log(`\n  Skolemad platform kører på → http://localhost:${PORT}\n`);
});
