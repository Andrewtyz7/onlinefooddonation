require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Test route - should work
app.get('/api/test', (req, res) => {
  res.json({ message: 'This route works!' });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://togtherwefeed.netlify.app',
    'http://localhost:5173'
  ],
}));

// Rate limiting (100 requests per 15 minutes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Payment endpoint
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd' } = req.body;
    
    // Validate amount
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      metadata: { integration_check: 'accept_a_payment' }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    });
  } catch (err) {
    console.error('Stripe Error:', err);
    res.status(500).json({ 
      error: err.type || 'Payment processing failed',
      message: err.message 
    });
  }
});

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Save donation record
app.post('/api/save-donation', async (req, res) => {
  try {
    const { amount, donor_name, donor_email, payment_intent_id } = req.body;
    
    const { data, error } = await supabase
      .from('donations')
      .insert([{
        amount,
        donor_name,
        donor_email,
        payment_intent_id,
        status: 'completed'
      }]);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err); // Always log errors
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));