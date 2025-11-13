// routes/store.js
const stripeLib = require('stripe');
const nodemailer = require('nodemailer');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Config = require('../models/Config');

module.exports = function(getEmailConfig, app) {
  const router = require('express').Router();

  let transporter;
  function createTransporter() {
    const cfg = getEmailConfig();
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: cfg.emailUser, pass: cfg.emailPass }
    });
  }
  createTransporter();

  router.createTransporter = createTransporter;

  // HOMEPAGE
  router.get('/', async (req, res) => {
    try {
      const products = await Product.find();
      res.render('index', { 
        products, 
        cart: req.session.cart || [] 
      });
    } catch (err) {
      console.error('Error loading homepage:', err);
      res.status(500).send('Server Error');
    }
  });

  // Add to Cart
  router.post('/add-to-cart/:id', async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).send('Product not found');

      if (!req.session.cart) req.session.cart = [];
      const existing = req.session.cart.find(i => i.id === req.params.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        req.session.cart.push({ 
          id: product._id.toString(), 
          name: product.name, 
          price: product.price, 
          quantity: 1,
          size: null
        });
      }
      res.redirect('/');
    } catch (err) {
      console.error(err);
      res.status(500).send('Server Error');
    }
  });

  // Update Size
  router.post('/update-cart-size', (req, res) => {
    const { index, size } = req.body;
    if (req.session.cart && req.session.cart[index]) {
      req.session.cart[index].size = size || null;
      if (size) {
        req.session.cart[index].displayName = `${req.session.cart[index].name} (Size ${size})`;
      } else {
        delete req.session.cart[index].displayName;
      }
    }
    res.json({ success: true });
  });

  // REMOVE FROM CART
  router.post('/remove-from-cart', (req, res) => {
    const { index } = req.body;
    if (req.session.cart && req.session.cart[index] !== undefined) {
      req.session.cart.splice(index, 1);
    }
    res.redirect('/cart');
  });

  // CLEAR ALL CART
  router.post('/clear-cart', (req, res) => {
    req.session.cart = [];
    res.redirect('/cart');
  });

  // Cart
  router.get('/cart', (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    res.render('cart', { cart, total });
  });

  // Checkout
  router.post('/checkout', async (req, res) => {
    try {
      const cfg = getEmailConfig();
      const config = await Config.findOne();
      if (!config?.stripeSecretKey) {
        return res.status(500).send('Stripe not configured');
      }
      const stripe = stripeLib(config.stripeSecretKey);

      const cart = req.session.cart || [];
      if (cart.length === 0) return res.redirect('/cart');

      const totalCents = cart.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: cart.map(item => ({
          price_data: {
            currency: 'gbp',
            product_data: { name: item.displayName || item.name },
            unit_amount: Math.round(item.price * 100)
          },
          quantity: item.quantity
        })),
        mode: 'payment',
        success_url: `${req.protocol}://${req.get('host')}/success`,
        cancel_url: `${req.protocol}://${req.get('host')}/cart`
      });

      const order = new Order({
        items: cart.map(i => ({ 
          product: i.id, 
          quantity: i.quantity,
          displayName: i.displayName
        })),
        total: totalCents / 100,
        email: req.body.email,
        stripeSessionId: session.id
      });
      await order.save();

      // Buyer Email
      await transporter.sendMail({
        from: cfg.emailUser,
        to: req.body.email,
        subject: 'Confirm Your Order',
        html: `
          <h3>Order #${order._id}</h3>
          <p>Total: £${(totalCents / 100).toFixed(2)}</p>
          <p><a href="${req.protocol}://${req.get('host')}/order/confirm/${order._id}">Confirm Order</a></p>
          <p><a href="${req.protocol}://${req.get('host')}/order/cancel/${order._id}">Cancel Order</a></p>
        `
      });

      // Owner Alert
      await transporter.sendMail({
        from: cfg.emailUser,
        to: cfg.sellerEmail,
        subject: `New Order #${order._id}`,
        text: `From: ${req.body.email} | Total: £${(totalCents / 100).toFixed(2)}`
      });

      res.redirect(303, session.url);
    } catch (err) {
      console.error('Checkout error:', err);
      res.status(500).send('Checkout failed');
    }
  });

  // Success
  router.get('/success', (req, res) => {
    req.session.cart = [];
    res.render('success', { message: 'Payment successful! Your order is confirmed.' });
  });

  // Confirm
  router.get('/order/confirm/:id', async (req, res) => {
    try {
      const cfg = getEmailConfig();
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).send('Order not found');
      order.status = 'Confirmed';
      await order.save();

      await transporter.sendMail({
        from: cfg.emailUser,
        to: cfg.sellerEmail,
        subject: `Order Confirmed #${order._id}`,
        text: 'Customer confirmed the order.'
      });

      res.send('<h1>Order Confirmed!</h1><p>Thank you!</p>');
    } catch (err) {
      res.status(500).send('Error');
    }
  });

  // Cancel
  router.get('/order/cancel/:id', async (req, res) => {
    try {
      const cfg = getEmailConfig();
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).send('Order not found');
      order.status = 'Cancelled';
      await order.save();

      const config = await Config.findOne();
      const stripe = stripeLib(config.stripeSecretKey);
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        if (session.payment_intent) {
          await stripe.refunds.create({ payment_intent: session.payment_intent });
        }
      } catch (e) {
        console.warn('Refund failed:', e);
      }

      await transporter.sendMail({
        from: cfg.emailUser,
        to: cfg.sellerEmail,
        subject: `Order Cancelled #${order._id}`,
        text: 'Customer cancelled. Refund processed.'
      });

      res.send('<h1>Order Cancelled</h1><p>Refunded.</p>');
    } catch (err) {
      res.status(500).send('Error');
    }
  });

  return router;
};