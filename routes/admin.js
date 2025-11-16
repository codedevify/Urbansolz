const multer = require('multer');
const path = require('path');

module.exports = function(getEmailConfig, app) {
  const cloudinary = require('cloudinary').v2;

  // Configure Cloudinary INSIDE factory — after dotenv is loaded
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  const Product = require('../models/Product');
  const Order = require('../models/Order');
  const Config = require('../models/Config');
  const Admin = require('../models/Admin');
  const EmailConfig = require('../models/EmailConfig');

  const router = require('express').Router();
  const storage = multer.memoryStorage();
  const upload = multer({ storage });

  const isAdmin = (req, res, next) => {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
  };

  // === LOGIN ===
  router.get('/login', (req, res) => res.render('admin/login'));
  router.post('/login', async (req, res) => {
    try {
      const admin = await Admin.findOne({ 
        username: req.body.username, 
        password: req.body.password 
      });
      if (admin) {
        req.session.admin = true;
        res.redirect('/admin');
      } else {
        res.send('Invalid login');
      }
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  });

  // === LOGOUT ===
  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  // === DASHBOARD ===
  router.get('/', isAdmin, async (req, res) => {
    try {
      const orders = await Order.find().sort({ createdAt: -1 });
      const products = await Product.find();

      const populatedOrders = await Promise.all(
        orders.map(async (order) => {
          const items = await Promise.all(
            order.items.map(async (item) => {
              if (item.displayName) {
                return { ...item.toObject(), name: item.displayName };
              }
              const product = await Product.findById(item.product);
              return { ...item.toObject(), name: product ? product.name : 'Unknown' };
            })
          );
          return { ...order.toObject(), items };
        })
      );

      const config = await Config.findOne();
      const emailConfig = await EmailConfig.findOne();

      res.render('admin/dashboard', { 
        orders: populatedOrders, 
        products, 
        config: config || {}, 
        emailConfig: emailConfig || {} 
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      res.status(500).send('Server error');
    }
  });

  // === EMAIL SETTINGS ===
  router.get('/email-settings', isAdmin, async (req, res) => {
    const emailConfig = await EmailConfig.findOne();
    res.render('admin/email-settings', { config: emailConfig || {} });
  });

  router.post('/email-config', isAdmin, async (req, res) => {
    try {
      const { emailUser, emailPass, sellerEmail } = req.body;
      await EmailConfig.updateOne(
        {},
        { emailUser, emailPass, sellerEmail },
        { upsert: true }
      );

      const storeRoutes = require('./store');
      const storeRouter = storeRoutes(getEmailConfig, app);
      if (storeRouter.createTransporter) {
        storeRouter.createTransporter();
      }

      res.redirect('/admin/email-settings');
    } catch (err) {
      console.error(err);
      res.status(500).send('Failed to update email config');
    }
  });

  // === ADD PRODUCT ===
  router.post('/product/add', isAdmin, upload.single('image'), async (req, res) => {
    let imageUrl = '';

    if (req.file) {
      try {
        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { resource_type: 'image' },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(req.file.buffer);
        });
        imageUrl = result.secure_url;
      } catch (err) {
        console.error('Image upload failed:', err);
        return res.status(500).send('Failed to upload image');
      }
    }

    try {
      const product = new Product({
        name: req.body.name,
        description: req.body.desc,
        price: req.body.price,
        image: imageUrl
      });
      await product.save();
      res.redirect('/admin');
    } catch (err) {
      console.error('Add failed:', err);
      res.status(500).send('Failed to save product');
    }
  });

  // === EDIT PRODUCT ===
  router.post('/product/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).send('Product not found');

      const update = {
        name: req.body.name,
        description: req.body.desc,
        price: req.body.price
      };

      if (req.file) {
        if (product.image && product.image.startsWith('https://res.cloudinary.com/')) {
          const publicId = product.image.split('/').pop().split('.')[0];
          try {
            await cloudinary.uploader.destroy(publicId);
          } catch (err) {
            console.warn('Failed to delete old image:', err);
          }
        }

        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { resource_type: 'image' },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(req.file.buffer);
        });
        update.image = result.secure_url;
      }

      await Product.findByIdAndUpdate(req.params.id, update);
      res.redirect('/admin');
    } catch (err) {
      console.error('Edit product error:', err);
      res.status(500).send('Server error');
    }
  });

  // === DELETE PRODUCT ===
  router.post('/product/delete/:id', isAdmin, async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).send('Product not found');

      if (product.image && product.image.startsWith('https://res.cloudinary.com/')) {
        const publicId = product.image.split('/').pop().split('.')[0];
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.warn('Failed to delete image from Cloudinary:', err);
        }
      }

      await Product.findByIdAndDelete(req.params.id);
      res.redirect('/admin');
    } catch (err) {
      console.error('Delete product error:', err);
      res.status(500).send('Failed to delete product');
    }
  });

  // === CONFIRM / CANCEL ORDER ===
  router.post('/order/confirm/:id', isAdmin, async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Confirmed' });
    res.redirect('/admin');
  });

  router.post('/order/cancel/:id', isAdmin, async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Cancelled' });
    res.redirect('/admin');
  });

  // === PAYMENT KEYS ===
  router.post('/config', isAdmin, async (req, res) => {
    await Config.updateOne(
      {},
      {
        stripePublishableKey: req.body.pk,
        stripeSecretKey: req.body.sk,
        paypalClientId: req.body.clientId,
        paypalSecret: req.body.secret
      },
      { upsert: true }
    );
    res.redirect('/admin');
  });

  return router;
};