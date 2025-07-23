require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

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
  "https://cokwmdjqgdywymlayyid.supabase.co",
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNva3dtZGpxZ2R5d3ltbGF5eWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxODk2ODYsImV4cCI6MjA2ODc2NTY4Nn0.jhhTETXwvnv1ThjobwydV2_45HdEUHCMKBmMcGZx_pw'
);

// Save donation record
app.post('/api/save-donation', async (req, res) => {
  try {
    const { amount, donor_name, donor_email, payment_intent_id } = req.body;
    
    // 1. Save donation to database
    const { data, error } = await supabase
      .from('donations')
      .insert([{
        amount,
        donor_name,
        donor_email,
        payment_intent_id
      }]);

    if (error) throw error;

    // 2. Retrieve payment intent to get customer details
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

    // 3. Create or retrieve customer in Stripe
    let customer;
    if (paymentIntent.customer) {
      customer = await stripe.customers.retrieve(paymentIntent.customer);
    } else {
      customer = await stripe.customers.create({
        email: donor_email,
        name: donor_name,
        metadata: {
          donation_id: data[0].id
        }
      });
      
      // Update payment intent with customer
      await stripe.paymentIntents.update(payment_intent_id, {
        customer: customer.id
      });
    }

    // 4. Create and send invoice
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      auto_advance: true, 
      collection_method: 'send_invoice',
      days_until_due: 0,
      description: `Donation to Together We Feed - Thank you for your generosity!`,
      metadata: {
        donation_id: data[0].id,
        payment_intent_id
      }
    });

    // Add invoice item
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: Math.round(amount * 100),
      currency: 'myr',
      description: 'Food donation to help those in need'
    });

    // Finalize and send invoice
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(finalizedInvoice.id);

    res.json({
      ...data[0],
      invoice_id: finalizedInvoice.id,
      invoice_url: finalizedInvoice.hosted_invoice_url
    });

  } catch (err) {
    console.error('Donation processing error:', err);
    res.status(500).json({ 
      error: err.message,
      type: err.type 
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err); // Always log errors
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));