const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

const defaultDb = {
  users: [],
  services: [
    // Instagram
    { id: 'SRV-5001', category: 'Instagram', name: 'Instagram Likes [Super Fast] [Max 50k]', rate: 45, min: 100, max: 50000, description: 'High quality Instagram likes. Starts instantly.' },
    { id: 'SRV-5002', category: 'Instagram', name: 'Instagram Followers [Real & Active] [30 Days Refill]', rate: 120, min: 100, max: 10000, description: 'Real active followers. 30-day refill guarantee.' },
    { id: 'SRV-5003', category: 'Instagram', name: 'Instagram Reels Views [Viral Boost]', rate: 15, min: 500, max: 1000000, description: 'Boost reels views fast. Organic style delivery.' },
    { id: 'SRV-5004', category: 'Instagram', name: 'Instagram Comments [Custom Text]', rate: 250, min: 10, max: 1000, description: 'Custom text comments from real profiles.' },
    
    // YouTube
    { id: 'SRV-5005', category: 'YouTube', name: 'YouTube Views [Non-Drop] [Lifetime Refill]', rate: 160, min: 500, max: 100000, description: 'Safe organic YouTube views. Helps in ranking.' },
    { id: 'SRV-5006', category: 'YouTube', name: 'YouTube Subscribers [Organic Growth] [No-Drop]', rate: 850, min: 50, max: 5000, description: 'Real YouTube subscribers. High retention.' },
    { id: 'SRV-5007', category: 'YouTube', name: 'YouTube Watch Time [4000 Hours Package]', rate: 2400, min: 1, max: 10, description: 'Get monetized fast. Full high retention watchtime pack.' },
    { id: 'SRV-5008', category: 'YouTube', name: 'YouTube Video Likes', rate: 180, min: 100, max: 10000, description: 'High quality video likes. Starts within 30 mins.' },
    
    // Facebook
    { id: 'SRV-5009', category: 'Facebook', name: 'Facebook Page Likes + Followers [Premium]', rate: 140, min: 100, max: 20000, description: 'Increase page likes and followers. Starts within 1 hour.' },
    { id: 'SRV-5010', category: 'Facebook', name: 'Facebook Post Video Views [Monetization Target]', rate: 90, min: 500, max: 50000, description: 'Fast video views for Facebook posts.' },
    { id: 'SRV-5011', category: 'Facebook', name: 'Facebook Profile Followers [Real]', rate: 160, min: 100, max: 10000, description: 'Real profile followers. High speed delivery.' },
    { id: 'SRV-5012', category: 'Facebook', name: 'Facebook Group Members [Organic]', rate: 220, min: 100, max: 5000, description: 'Add members to your group. High quality profiles.' }
  ],
  orders: [],
  transactions: [],
  config: {
    lastUserId: 1000,
    lastOrderId: 2000,
    lastTxnId: 3000,
    lastSrvId: 5012
  }
};

class JSONDatabase {
  constructor() {
    this.data = null;
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
      } else {
        this.data = defaultDb;
        this.save();
      }
    } catch (error) {
      console.error('Failed to initialize database, resetting to default:', error);
      this.data = defaultDb;
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to write database file:', error);
    }
  }

  // --- Users Operations ---
  getUsers() {
    return this.data.users;
  }

  getUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  getUserByMobile(mobile) {
    return this.data.users.find(u => u.mobile === mobile);
  }

  createUser(mobile, passwordHash, ip, location = 'Unknown') {
    this.data.config.lastUserId++;
    const newId = `USR-${this.data.config.lastUserId}`;
    const newUser = {
      id: newId,
      mobile,
      password: passwordHash,
      balance: 0,
      totalSpent: 0,
      registrationIp: ip,
      registrationLocation: location,
      lastLoginIp: ip,
      lastLoginLocation: location,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(newUser);
    this.save();
    return newUser;
  }

  updateUser(id, updates) {
    const userIndex = this.data.users.findIndex(u => u.id === id);
    if (userIndex !== -1) {
      this.data.users[userIndex] = { ...this.data.users[userIndex], ...updates };
      this.save();
      return this.data.users[userIndex];
    }
    return null;
  }

  // --- Services Operations ---
  getServices() {
    return this.data.services;
  }

  getServiceById(id) {
    return this.data.services.find(s => s.id === id);
  }

  createService(category, name, rate, min, max, description) {
    this.data.config.lastSrvId++;
    const newId = `SRV-${this.data.config.lastSrvId}`;
    const newService = {
      id: newId,
      category,
      name,
      rate: Number(rate),
      min: Number(min),
      max: Number(max),
      description: description || ''
    };
    this.data.services.push(newService);
    this.save();
    return newService;
  }

  deleteService(id) {
    const index = this.data.services.findIndex(s => s.id === id);
    if (index !== -1) {
      const removed = this.data.services.splice(index, 1);
      this.save();
      return removed[0];
    }
    return null;
  }

  // --- Orders Operations ---
  getOrders() {
    return this.data.orders;
  }

  getOrdersByUserId(userId) {
    return this.data.orders.filter(o => o.userId === userId);
  }

  createOrder(userId, serviceId, link, quantity, price) {
    this.data.config.lastOrderId++;
    const newId = `ORD-${this.data.config.lastOrderId}`;
    const newOrder = {
      id: newId,
      userId,
      serviceId,
      link,
      quantity: Number(quantity),
      price: Number(price),
      status: 'Pending',
      createdAt: new Date().toISOString()
    };
    this.data.orders.push(newOrder);
    this.save();
    return newOrder;
  }

  updateOrderStatus(orderId, status) {
    const order = this.data.orders.find(o => o.id === orderId);
    if (order) {
      order.status = status;
      this.save();
      return order;
    }
    return null;
  }

  // --- Transactions Operations ---
  getTransactions() {
    return this.data.transactions;
  }

  getTransactionsByUserId(userId) {
    return this.data.transactions.filter(t => t.userId === userId);
  }

  getTransactionByUtr(utr) {
    return this.data.transactions.find(t => t.utr === utr);
  }

  createTransaction(userId, amount, utr, ip, location = 'Unknown') {
    this.data.config.lastTxnId++;
    const newId = `TXN-${this.data.config.lastTxnId}`;
    const newTxn = {
      id: newId,
      userId,
      amount: Number(amount),
      utr,
      ip,
      location,
      status: 'Pending',
      createdAt: new Date().toISOString(),
      approvedAt: null
    };
    this.data.transactions.push(newTxn);
    this.save();
    return newTxn;
  }

  updateTransactionStatus(txnId, status) {
    const txn = this.data.transactions.find(t => t.id === txnId);
    if (txn) {
      txn.status = status;
      if (status === 'Approved') {
        txn.approvedAt = new Date().toISOString();
      }
      this.save();
      return txn;
    }
    return null;
  }
}

module.exports = new JSONDatabase();
