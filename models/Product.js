// models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, default: '' },
  category: { 
    type: String, 
    enum: ['shoe', 'hat'], 
    default: 'shoe'  // Existing products will default to 'shoe'
  }
});

module.exports = mongoose.model('Product', productSchema);