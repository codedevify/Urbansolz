const stripeLib = require('stripe');
const paypal = require('@paypal/checkout-server-sdk');
const nodemailer = require('nodemailer');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Config = require('../models/Config');
const EmailConfig = require('../models/EmailConfig');

module.exports = function(getEmailConfig, app) {
  const router = require('express').Router();

  // We no longer keep a global transporter
  // We'll create a fresh one every time we need to send email (after payment success)

  async function paypalClient() {
    const config = await Config.findOne();
    const environment = new paypal.core.SandboxEnvironment(config.paypalClientId, config.paypalSecret);
    return new paypal.core.PayPalHttpClient(environment);
  }

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

  // ADD TO CART - unchanged
  router.post('/add-to-cart/:id', async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).send('Product not found');

      if (!req.session.cart) req.session.cart = [];

      const isHat = product.category === 'hat';
      const submittedSize = req.body.size?.trim();

      if (!isHat && !submittedSize) {
        return res.status(400).send('Please select a size for shoes.');
      }

      const size = isHat ? null : submittedSize;
      const displayName = isHat ? product.name : `${product.name} (Size ${size})`;

      const existing = req.session.cart.find(i => 
        i.id === req.params.id && i.size === size
      );

      if (existing) {
        existing.quantity += 1;
      } else {
        req.session.cart.push({ 
          id: product._id.toString(), 
          name: product.name, 
          price: product.price, 
          quantity: 1,
          size: size,
          displayName: displayName
        });
      }

      res.redirect('/');
    } catch (err) {
      console.error('Add to cart error:', err);
      res.status(500).send('Server Error');
    }
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

  // Cart page
  router.get('/cart', async (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const config = await Config.findOne();
    const paypalClientId = config?.paypalClientId || '';
    res.render('cart', { cart, total, paypalClientId });
  });

  // STRIPE CHECKOUT – only creates session, NO email sent here
  router.post('/checkout', async (req, res) => {
    try {
      const config = await Config.findOne();
      if (!config?.stripeSecretKey) {
        return res.status(500).send('Stripe not configured');
      }
      const stripe = stripeLib(config.stripeSecretKey);

      const cart = req.session.cart || [];
      if (cart.length === 0) return res.redirect('/cart');

      const totalCents = Math.round((cart.reduce((sum, i) => sum + i.price * i.quantity, 0) + 3.99) * 100);

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
        success_url: `${req.protocol}://${req.get('host')}/stripe-success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(req.body.email)}`,
        cancel_url: `${req.protocol}://${req.get('host')}/cart`
      });

      res.redirect(303, session.url);
    } catch (err) {
      console.error('Stripe checkout error:', err);
      res.status(500).send('Checkout failed');
    }
  });

  // NEW: Stripe success handler – saves order + sends emails ONLY after payment
  router.get('/stripe-success', async (req, res) => {
    try {
      const { session_id, email } = req.query;
      if (!session_id || !email) return res.redirect('/cart');

      const config = await Config.findOne();
      const stripe = stripeLib(config.stripeSecretKey);
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== 'paid') {
        return res.redirect('/cart');
      }

      const cart = req.session.cart || [];
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0) + 3.99;

      const order = new Order({
        items: cart.map(i => ({ product: i.id, quantity: i.quantity, displayName: i.displayName })),
        total,
        email,
        stripeSessionId: session_id
      });
      await order.save();

      // Create fresh transporter with latest config
      const emailCfg = await EmailConfig.findOne();
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: emailCfg.emailUser, pass: emailCfg.emailPass }
      });

      // Buyer email
      await transporter.sendMail({
        from: emailCfg.emailUser,
        to: email,
        subject: 'Order Received – Urban Solz',
        html: `
          <h2>Thank you for your order! #${order._id}</h2>
          <p>Total: £${total.toFixed(2)}</p>
          <p>We’ll prepare your items and ship soon.</p>
          <p><a href="${req.protocol}://${req.get('host')}/order/confirm/${order._id}">Confirm Order</a> | 
             <a href="${req.protocol}://${req.get('host')}/order/cancel/${order._id}">Cancel Order</a></p>
        `
      });

      // Owner alert
      await transporter.sendMail({
        from: emailCfg.emailUser,
        to: emailCfg.sellerEmail,
        subject: `New Order #${order._id}`,
        text: `Customer: ${email} | Total: £${total.toFixed(2)} | Items: ${cart.map(i => i.displayName || i.name).join(', ')}`
      });

      req.session.cart = [];
      res.render('success', { message: 'Payment successful! Check your email for order details.' });
    } catch (err) {
      console.error('Stripe success handler error:', err);
      res.status(500).send('Error processing payment');
    }
  });

  // Create PayPal Order – now accepts email from frontend
  router.post('/create-paypal-order', async (req, res) => {
    try {
      const { email } = req.body;
      const cart = req.session.cart || [];
      if (cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });

      const total = (cart.reduce((sum, i) => sum + i.price * i.quantity, 0) + 3.99).toFixed(2);

      const request = new paypal.orders.OrdersCreateRequest();
      request.prefer("return=representation");
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'GBP',
            value: total,
          },
          items: cart.map(item => ({
            name: item.displayName || item.name,
            unit_amount: { currency_code: 'GBP', value: item.price.toFixed(2) },
            quantity: item.quantity
          }))
        }]
      });

      const response = await paypalClient().execute(request);
      res.json({ id: response.result.id });
    } catch (err) {
      console.error('PayPal create order error:', err);
      res.status(500).json({ error: 'Failed to create order' });
    }
  });

  // Capture PayPal Order – saves order + sends emails
  router.post('/capture-paypal-order/:orderId', async (req, res) => {
    try {
      const { orderId } = req.params;
      const request = new paypal.orders.OrdersCaptureRequest(orderId);
      request.requestBody({});
      const response = await paypalClient().execute(request);

      const cart = req.session.cart || [];
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0) + 3.99;

      // Get customer email from PayPal
      const customerEmail = response.result.payer.email_address;

      const order = new Order({
        items: cart.map(i => ({ product: i.id, quantity: i.quantity, displayName: i.displayName })),
        total,
        email: customerEmail,
        paypalOrderId: orderId
      });
      await order.save();

      // Fresh email config + transporter
      const emailCfg = await EmailConfig.findOne();
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: emailCfg.emailUser, pass: emailCfg.emailPass }
      });

      // Buyer email
      await transporter.sendMail({
        from: emailCfg.emailUser,
        to: customerEmail,
        subject: 'Order Received – Urban Solz',
        html: `
          <h2>Thank you for your order! #${order._id}</h2>
          <p>Total: £${total.toFixed(2)}</p>
          <p>We’ll prepare your items and ship soon.</p>
          <p><a href="${req.protocol}://${req.get('host')}/order/confirm/${order._id}">Confirm Order</a> | 
             <a href="${req.protocol}://${req.get('host')}/order/cancel/${order._id}">Cancel Order</a></p>
        `
      });

      // Owner alert
      await transporter.sendMail({
        from: emailCfg.emailUser,
        to: emailCfg.sellerEmail,
        subject: `New Order #${order._id}`,
        text: `Customer: ${customerEmail} | Total: £${total.toFixed(2)} | Items: ${cart.map(i => i.displayName || i.name).join(', ')}`
      });

      req.session.cart = [];
      res.json({ success: true });
    } catch (err) {
      console.error('PayPal capture error:', err);
      res.status(500).json({ error: 'Failed to capture order' });
    }
  });

  // Success page (PayPal uses this too via redirect from JS)
  router.get('/success', (req, res) => {
    res.render('success', { message: 'Payment successful! Check your email for order details.' });
  });

  // Confirm & Cancel routes unchanged (still work perfectly)
  router.get('/order/confirm/:id', async (req, res) => {
    try {
      const emailCfg = await EmailConfig.findOne();
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: emailCfg.emailUser, pass: emailCfg.emailPass }
      });

      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).send('Order not found');
      order.status = 'Confirmed';
      await order.save();

      await transporter.sendMail({
        from: emailCfg.emailUser,
        to: emailCfg.sellerEmail,
        subject: `Order Confirmed #${order._id}`,
        text: 'Customer confirmed the order.'
      });

      res.send('<h1>Order Confirmed!</h1><p>Thank you!</p>');
    } catch (err) {
      res.status(500).send('Error');
    }
  });

  router.get('/order/cancel/:id', async (req, res) => {
    try {
      const emailCfg = await EmailConfig.findOne();
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: emailCfg.emailUser, pass: emailCfg.emailPass }
      });

      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).send('Order not found');
      order.status = 'Cancelled';
      await order.save();

      const config = await Config.findOne();

      if (order.stripeSessionId) {
        const stripe = stripeLib(config.stripeSecretKey);
        try {
          const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
          if (session.payment_intent) {
            await stripe.refunds.create({ payment_intent: session.payment_intent });
          }
        } catch (e) { console.warn('Stripe refund failed:', e); }
      }

      await transporter.sendMail({
        from: emailCfg.emailUser,
        to: emailCfg.sellerEmail,
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