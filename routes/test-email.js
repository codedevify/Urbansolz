// routes/test-email.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

router.get('/test-email', async (req, res) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.SELLER_EMAIL,          // <-- your owner email
      subject: 'Nodemailer TEST – IT WORKS!',
      text: 'If you see this, Nodemailer + Gmail is 100% working.',
      html: '<h1>Nodemailer TEST</h1><p>Success! Your email setup is correct.</p>'
    });

    res.send(`
      <h2>Email Sent!</h2>
      <p>Message ID: <code>${info.messageId}</code></p>
      <p>Check <strong>${process.env.SELLER_EMAIL}</strong> inbox (and spam).</p>
      <a href="/">Back to Store</a>
    `);
  } catch (err) {
    console.error('Nodemailer error:', err);
    res.status(500).send(`
      <h2>Error</h2>
      <pre>${err.message}</pre>
      <p>Check terminal for details.</p>
    `);
  }
});

module.exports = router;