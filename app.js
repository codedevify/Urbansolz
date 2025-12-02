const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

const app = express();

// --- MIDDLEWARE ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // Important: needed for PayPal webhook-like calls
app.use(express.static('public'));
app.use(session({
  secret: 'shoe-store-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));
app.set('view engine', 'ejs');

// --- DATABASE ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('DB Error:', err));

// --- MODELS ---
const Product = require('./models/Product');
const Order = require('./models/Order');
const Config = require('./models/Config');
const Admin = require('./models/Admin');
const EmailConfig = require('./models/EmailConfig');

// --- GLOBAL EMAIL CONFIG (kept for admin panel only) ---
// We no longer use a global transporter – emails are sent with fresh config after payment
let getEmailConfig = () => ({ emailUser: 'fallback@gmail.com', emailPass: 'pass', sellerEmail: 'owner@example.com' });

async function loadEmailConfig() {
  let config = await EmailConfig.findOne();
  if (!config) {
    config = new EmailConfig({
      emailUser: process.env.EMAIL_USER || 'fallback@gmail.com',
      emailPass: process.env.EMAIL_PASS || 'fallback-pass',
      sellerEmail: process.env.SELLER_EMAIL || 'owner@example.com'
    });
    await config.save();
    console.log('Email config seeded from .env');
  }
  getEmailConfig = () => config;
  console.log('Email Config Loaded:', { from: config.emailUser, alerts: config.sellerEmail });
}
loadEmailConfig();

// --- PASS CONFIG TO ROUTES ---
const storeRoutesFactory = require('./routes/store');
const adminRoutesFactory = require('./routes/admin');

// Pass the getter function – store.js no longer uses global transporter
const storeRoutes = storeRoutesFactory(getEmailConfig, app);
const adminRoutes = adminRoutesFactory(getEmailConfig, app);

app.use('/', storeRoutes);
app.use('/admin', adminRoutes);

// --- SEED DATA ---
async function seedData() {
  try {
    if (await Admin.countDocuments() === 0) {
      await new Admin({ username: 'admin', password: 'password' }).save();
      console.log('Admin created: admin / password');
    }

    if (await Product.countDocuments() === 0) {
      const products = [
        { name: 'Nike Air Max', description: 'Comfortable running shoes', price: 120, image: 'https://via.placeholder.com/300x200?text=Nike+Air+Max' },
        { name: 'Adidas Ultraboost', description: 'High performance', price: 180, image: 'https://via.placeholder.com/300x200?text=Adidas+Ultraboost' },
        { name: 'Puma RS-X', description: 'Bold street style', price: 110, image: 'https://via.placeholder.com/300x200?text=Puma+RS-X' },
        { name: 'Reebok Classic', description: 'Timeless design', price: 80, image: 'https://via.placeholder.com/300x200?text=Reebok+Classic' },
        { name: 'Vans Old Skool', description: 'Skate culture icon', price: 70, image: 'https://via.placeholder.com/300x200?text=Vans+Old+Skool' },
        { name: 'Converse Chuck 70', description: 'Vintage high-top', price: 85, image: 'https://via.placeholder.com/300x200?text=Converse+Chuck+70' },
        { name: 'New Balance 550', description: 'Retro basketball', price: 130, image: 'https://via.placeholder.com/300x200?text=New+Balance+550' },
        { name: 'Jordan 1 Low', description: 'Iconic style', price: 150, image: 'https://via.placeholder.com/300x200?text=Jordan+1+Low' }
      ];
      await Product.insertMany(products);
      console.log('8 Products Seeded with placeholder images');
    }

    if (await Config.countDocuments() === 0) {
      await new Config({
        stripePublishableKey: 'pk_test_xxx',
        stripeSecretKey: 'sk_test_xxx'
      }).save();
      console.log('Payment Config Seeded (PayPal keys must be set in admin)');
    }
  } catch (e) {
    console.error('Seed error:', e);
  }
}

seedData();

// --- FINAL FALLBACK ROUTE (404) ---
app.use((req, res) => {
  res.status(404).send('<h1>404 - Page Not Found</h1><a href="/">Back to Shop</a>');
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});