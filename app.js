require('dotenv').config();
const express = require('express');
const app = express();

// Test route - should work
app.get('/api/test', (req, res) => {
  res.json({ message: 'This route works!' });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));