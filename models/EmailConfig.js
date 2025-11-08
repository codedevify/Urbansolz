const mongoose = require('mongoose');

const emailConfigSchema = new mongoose.Schema({
  emailUser: { type: String, required: true },     // codedevify@gmail.com
  emailPass: { type: String, required: true },     // abcd efgh ijkl mnop
  sellerEmail: { type: String, required: true }    // owner@shop.com
});

module.exports = mongoose.model('EmailConfig', emailConfigSchema);