require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

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

// NEW: Create Checkout Session endpoint
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { amount, donor_name, donor_email } = req.body;
    
    // Validate amount
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'myr',
          product_data: {
            name: 'Food Donation',
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: donor_email,
      metadata: {
        donor_name: donor_name,
        donation: 'true'
      },
      success_url: `https://togtherwefeed.netlify.app/donation-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://togtherwefeed.netlify.app/donation-canceled`,
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error('Stripe Checkout Error:', err);
    res.status(500).json({ 
      error: err.type || 'Checkout session creation failed',
      message: err.message 
    });
  }
});

// Webhook endpoint for Stripe events
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      // Save donation to database
      const { data, error } = await supabase
        .from('donations')
        .insert([{
          amount: session.amount_total / 100, // Convert back to RM
          donor_name: session.metadata.donor_name,
          donor_email: session.customer_email,
          payment_intent_id: session.payment_intent
        }]);

      if (error) throw error;

      // Send invoice email
      await sendDonationReceipt(
        session.customer_email,
        session.metadata.donor_name,
        session.amount_total / 100,
        session.id
      );

    } catch (err) {
      console.error('Post-checkout processing error:', err);
    }
  }

  res.json({ received: true });
});

// Helper function to send donation receipt
async function sendDonationReceipt(email, name, amount, sessionId) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Thank You for Your Donation',
      html: `
        <h2>Thank You for Your Generous Donation</h2>
        <p>Dear ${name},</p>
        <p>We've successfully received your donation of RM${amount.toFixed(2)}.</p>
        <p>Your support helps us fight hunger and reduce food waste in our community.</p>
        <p>Transaction ID: ${sessionId}</p>
        <p>This email serves as your receipt. If you need an official tax receipt, please reply to this email.</p>
        <p>With gratitude,</p>
        <p>The TogetherWeFeed Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error('Error sending donation receipt:', err);
  }
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  "https://cokwmdjqgdywymlayyid.supabase.co",
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNva3dtZGpxZ2R5d3ltbGF5eWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxODk2ODYsImV4cCI6MjA2ODc2NTY4Nn0.jhhTETXwvnv1ThjobwydV2_45HdEUHCMKBmMcGZx_pw'
);

const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: 'pwrandrew@gmail.com', 
    pass: 'ziebaleaxrimnmyc' 
  }
});

// Volunteer form submission endpoint
app.post('/api/volunteer', async (req, res) => {
  try {
    const { formData, recipientEmail } = req.body;
    
    // Email to company
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipientEmail,
      subject: 'New Volunteer Application',
      html: `
        <h2>New Volunteer Application</h2>
        <p><strong>Name:</strong> ${formData.fullName}</p>
        <p><strong>Email:</strong> ${formData.email}</p>
        <p><strong>About:</strong> ${formData.about}</p>
        <p><strong>Motivation:</strong> ${formData.motivation}</p>
        ${formData.socialMedia ? `<p><strong>Social Media:</strong> ${formData.socialMedia}</p>` : ''}
        <p>Please review this application and respond within 5 working days.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    
    // Optional: Send confirmation email to volunteer
    const volunteerMailOptions = {
      from: process.env.EMAIL_USER,
      to: formData.email,
      subject: 'Thank You for Your Volunteer Application',
      text: `Dear ${formData.fullName},\n\nThank you for applying to volunteer with TogetherWeFeed. We have received your application and will review it shortly. Our team will contact you within 5 working days.\n\nBest regards,\nThe TogetherWeFeed Team`
    };

    await transporter.sendMail(volunteerMailOptions);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email Error:', err);
    res.status(500).json({ error: 'Failed to process application' });
  }
});

// Food donation form submission endpoint
app.post('/api/food-donation', async (req, res) => {
  try {
    const { formData, recipientEmail } = req.body;
    
    // Email to company
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipientEmail,
      subject: 'New Food Donation Submission',
      html: `
        <h2>New Food Donation</h2>
        <p><strong>Name:</strong> ${formData.fullName}</p>
        <p><strong>Email:</strong> ${formData.email}</p>
        <p><strong>Address:</strong> ${formData.address}</p>
        <p><strong>Food Type:</strong> ${formData.foodType}</p>
        <p><strong>Quantity:</strong> ${formData.quantity}</p>
        <p><strong>Donation Method:</strong> ${formData.donationMethod}</p>
        ${formData.pickupLocation ? `<p><strong>Pickup Location:</strong> ${formData.pickupLocation}</p>` : ''}
        <p>Please contact the donor within 2 working days to arrange details.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    
    // Optional: Send confirmation email to donor
    const donorMailOptions = {
      from: process.env.EMAIL_USER,
      to: formData.email,
      subject: 'Thank You for Your Food Donation',
      text: `Dear ${formData.fullName},\n\nThank you for your generous food donation to TogetherWeFeed. We have received your submission and will contact you within 2 working days to arrange the details.\n\nYour contribution will help feed those in need in our community.\n\nBest regards,\nThe TogetherWeFeed Team`
    };

    await transporter.sendMail(donorMailOptions);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email Error:', err);
    res.status(500).json({ error: 'Failed to process donation' });
  }
});

// Event request form submission endpoint
app.post('/api/event-request', async (req, res) => {
  try {
    const { formData, recipientEmail } = req.body;
    
    // Email to company
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipientEmail,
      subject: 'New Event Organization Request',
      html: `
        <h2>New Event Request</h2>
        <p><strong>Name:</strong> ${formData.fullName}</p>
        <p><strong>Company:</strong> ${formData.companyName}</p>
        <p><strong>Email:</strong> ${formData.email}</p>
        <p><strong>Address:</strong> ${formData.address}</p>
        <p><strong>Company Address:</strong> ${formData.companyAddress}</p>
        <p><strong>Event Type:</strong> ${formData.eventType}</p>
        <p><strong>Event Date:</strong> ${formData.eventDate}</p>
        <p><strong>Event Description:</strong></p>
        <p>${formData.eventDescription}</p>
        <p>Please contact the organizer within 3 business days to discuss details.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    
    // Optional: Send confirmation email to requester
    const requesterMailOptions = {
      from: process.env.EMAIL_USER,
      to: formData.email,
      subject: 'Thank You for Your Event Request',
      text: `Dear ${formData.fullName},\n\nThank you for your event organization request to TogetherWeFeed. We have received your submission and will review it shortly. Our team will contact you within 3 business days to discuss next steps.\n\nFor any urgent inquiries, please contact events@togetherwefeed.org.\n\nBest regards,\nThe TogetherWeFeed Team`
    };

    await transporter.sendMail(requesterMailOptions);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email Error:', err);
    res.status(500).json({ error: 'Failed to process event request' });
  }
});

app.use((err, req, res, next) => {
  console.error(err); // Always log errors
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));