// routes/admin.js
const multer = require('multer');
const path = require('path');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Config = require('../models/Config');
const Admin = require('../models/Admin');
const EmailConfig = require('../models/EmailConfig');

module.exports = function(getEmailConfig, app) {
  const router = require('express').Router();

  const storage = multer.diskStorage({
    destination: './public/uploads',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  });
  const upload = multer({ storage });

  const isAdmin = (req, res, next) => {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
  };

  // Login
  router.get('/login', (req, res) => res.render('admin/login'));
  router.post('/login', async (req, res) => {
    const admin = await Admin.findOne({ username: req.body.username, password: req.body.password });
    if (admin) {
      req.session.admin = true;
      res.redirect('/admin');
    } else {
      res.send('Invalid login');
    }
  });

  // Dashboard
  router.get('/', isAdmin, async (req, res) => {
    const [orders, products, config, emailConfig] = await Promise.all([
      Order.find().populate('items.product'),
      Product.find(),
      Config.findOne(),
      EmailConfig.findOne()
    ]);
    res.render('admin/dashboard', { orders, products, config, emailConfig });
  });

  // Email Settings Page
  router.get('/email-settings', isAdmin, async (req, res) => {
    const emailConfig = await EmailConfig.findOne();
    res.render('admin/email-settings', { config: emailConfig });
  });

  // Save Email Config + Refresh Transporter
  router.post('/email-config', isAdmin, async (req, res) => {
    const { emailUser, emailPass, sellerEmail } = req.body;
    await EmailConfig.updateOne(
      {},
      { emailUser, emailPass, sellerEmail },
      { upsert: true }
    );

    // === REFRESH EMAIL TRANSPORTER ===
    // Re-require store route and call createTransporter
    const storeRoutes = require('./store');
    const storeRouter = storeRoutes(getEmailConfig, app);
    if (storeRouter.createTransporter) {
      storeRouter.createTransporter();
    }

    res.redirect('/admin/email-settings');
  });

  // Add Product
  router.post('/product/add', isAdmin, upload.single('image'), async (req, res) => {
    const product = new Product({
      name: req.body.name,
      description: req.body.desc,
      price: req.body.price,
      image: '/uploads/' + req.file.filename
    });
    await product.save();
    res.redirect('/admin');
  });

  // Edit Product
  router.post('/product/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    const update = {
      name: req.body.name,
      description: req.body.desc,
      price: req.body.price
    };
    if (req.file) update.image = '/uploads/' + req.file.filename;
    await Product.findByIdAndUpdate(req.params.id, update);
    res.redirect('/admin');
  });

  // Confirm Order
  router.post('/order/confirm/:id', isAdmin, async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Confirmed' });
    res.redirect('/admin');
  });

  // Cancel Order
  router.post('/order/cancel/:id', isAdmin, async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Cancelled' });
    res.redirect('/admin');
  });

  // Update Stripe Keys
  router.post('/config', isAdmin, async (req, res) => {
    await Config.updateOne(
      {},
      {
        stripePublishableKey: req.body.pk,
        stripeSecretKey: req.body.sk
      }
    );
    res.redirect('/admin');
  });

  return router;
};