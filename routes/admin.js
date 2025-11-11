// routes/admin.js
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Product = require('../models/Product');
const Order = require('../models/Order');
const Config = require('../models/Config');
const Admin = require('../models/Admin');
const EmailConfig = require('../models/EmailConfig');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = function (getEmailConfig, app) {
  const router = require('express').Router();
  const upload = multer({ storage: multer.memoryStorage() });

  const isAdmin = (req, res, next) => {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
  };

  // LOGIN PAGE
  router.get('/login', (req, res) => {
    if (req.query.logout) {
      req.session.destroy();
      return res.redirect('/');
    }
    res.render('admin/login');
  });

  // LOGIN POST
  router.post('/login', async (req, res) => {
    try {
      const admin = await Admin.findOne({
        username: req.body.username,
        password: req.body.password,
      });
      if (admin) {
        req.session.admin = true;
        req.session.save((err) => {
          if (err) console.error('Session save error:', err);
          res.redirect('/admin');
        });
      } else {
        res.send('Invalid credentials');
      }
    } catch (err) {
      res.status(500).send('Server error');
    }
  });

  // DASHBOARD
  router.get('/', isAdmin, async (req, res) => {
    const [orders, products, config, emailConfig] = await Promise.all([
      Order.find().populate('items.product'),
      Product.find(),
      Config.findOne(),
      EmailConfig.findOne(),
    ]);
    res.render('admin/dashboard', {
      orders,
      products,
      config: config || {},
      emailConfig: emailConfig || {},
    });
  });

  // EMAIL SETTINGS
  router.get('/email-settings', isAdmin, async (req, res) => {
    const config = await EmailConfig.findOne();
    res.render('admin/email-settings', { config: config || {} });
  });

  router.post('/email-config', isAdmin, async (req, res) => {
    await EmailConfig.updateOne({}, req.body, { upsert: true });
    const storeRouter = require('./store')(getEmailConfig, app);
    if (storeRouter.createTransporter) storeRouter.createTransporter();
    res.redirect('/admin/email-settings');
  });

  // ADD PRODUCT
  router.post('/product/add', isAdmin, upload.single('image'), async (req, res) => {
    let imageUrl = '';
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(req.file.buffer);
      });
      imageUrl = result.secure_url;
    }
    await new Product({
      name: req.body.name,
      description: req.body.desc,
      price: parseFloat(req.body.price),
      image: imageUrl,
    }).save();
    res.redirect('/admin');
  });

  // EDIT PRODUCT
  router.post('/product/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    const product = await Product.findById(req.params.id);
    const update = {
      name: req.body.name,
      description: req.body.desc,
      price: parseFloat(req.body.price),
    };
    if (req.file) {
      if (product.image) {
        const publicId = product.image.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(publicId).catch(() => {});
      }
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(req.file.buffer);
      });
      update.image = result.secure_url;
    }
    await Product.findByIdAndUpdate(req.params.id, update);
    res.redirect('/admin');
  });

  // DELETE PRODUCT
  router.post('/product/delete/:id', isAdmin, async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (product.image) {
      const publicId = product.image.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId).catch(() => {});
    }
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  });

  // STRIPE KEYS
  router.post('/config', isAdmin, async (req, res) => {
    await Config.updateOne(
      {},
      {
        stripePublishableKey: req.body.pk,
        stripeSecretKey: req.body.sk,
      },
      { upsert: true }
    );
    res.redirect('/admin');
  });

  // ORDER ACTIONS
  router.post('/order/confirm/:id', isAdmin, async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Confirmed' });
    res.redirect('/admin');
  });

  router.post('/order/cancel/:id', isAdmin, async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Cancelled' });
    res.redirect('/admin');
  });

  return router;
};
