const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Lisha index.html yako
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', bot: 'jokerbot' });
});

// Anza bot baada ya server
try {
  require('./index.js');
  console.log('✅ Bot index.js loaded');
} catch (e) {
  console.log('⚠️ Bot not loaded:', e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Site on ${PORT}`);
  console.log(`Serving index.html`);
});
