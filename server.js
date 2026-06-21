const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Admin configuration
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_HASH = hashPassword('admin123'); // Default: admin123
let adminSessions = new Set(); // Admin session tokens

// Hashing helper
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// IP Geolocation Helper
function getIpLocation(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '::ffff:127.0.0.1') {
      return resolve('Local Host (India)');
    }
    
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve('Unknown Location (Timeout)');
      }
    }, 2000);

    https.get(`https://ipapi.co/${ip}/json/`, { headers: { 'User-Agent': 'node-smm-panel' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try {
          const json = JSON.parse(data);
          if (json.city && json.country_name) {
            resolve(`${json.city}, ${json.country_name}`);
          } else if (json.country_name) {
            resolve(json.country_name);
          } else {
            resolve('Unknown Location');
          }
        } catch (e) {
          resolve('Unknown Location');
        }
      });
    }).on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve('Unknown Location (Error)');
    });
  });
}

// IP helper
function getClientIp(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (ip.includes(',')) {
    return ip.split(',')[0].trim().replace(/^.*:/, '');
  }
  return ip.replace(/^.*:/, '') || '127.0.0.1';
}

// Generate secure session token
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Middlewares
function authenticateUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  const token = authHeader.split(' ')[1];
  const users = db.getUsers();
  const user = users.find(u => u.sessionToken === token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please login again.' });
  }
  req.user = user;
  next();
}

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin access required.' });
  }
  const token = authHeader.split(' ')[1];
  if (!adminSessions.has(token)) {
    return res.status(401).json({ error: 'Invalid or expired admin session.' });
  }
  next();
}

// ==========================================
// USER AUTHENTICATION
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { mobile, password } = req.body;
    const ip = getClientIp(req);
    const location = await getIpLocation(ip);

    if (!mobile || mobile.trim().length < 10) {
      return res.status(400).json({ error: 'Please enter a valid mobile number (min 10 digits).' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existingUser = db.getUserByMobile(mobile);
    if (existingUser) {
      return res.status(400).json({ error: 'Mobile number already registered.' });
    }

    const passwordHash = hashPassword(password);
    const user = db.createUser(mobile, passwordHash, ip, location);
    
    // Generate session
    const sessionToken = generateToken();
    db.updateUser(user.id, { sessionToken, lastLoginIp: ip, lastLoginLocation: location });

    res.status(201).json({
      message: 'Registration successful!',
      token: sessionToken,
      user: { id: user.id, mobile: user.mobile, balance: user.balance }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;
    const ip = getClientIp(req);
    const location = await getIpLocation(ip);

    if (!mobile || !password) {
      return res.status(400).json({ error: 'Mobile number and password are required.' });
    }

    const user = db.getUserByMobile(mobile);
    if (!user) {
      return res.status(400).json({ error: 'User not found. Please register first.' });
    }

    const passwordHash = hashPassword(password);
    if (user.password !== passwordHash) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    // Generate session
    const sessionToken = generateToken();
    db.updateUser(user.id, { sessionToken, lastLoginIp: ip, lastLoginLocation: location });

    res.json({
      message: 'Login successful!',
      token: sessionToken,
      user: { id: user.id, mobile: user.mobile, balance: user.balance }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Get User Profile
app.get('/api/user/profile', authenticateUser, (req, res) => {
  res.json({
    id: req.user.id,
    mobile: req.user.mobile,
    balance: req.user.balance,
    totalSpent: req.user.totalSpent
  });
});

// ==========================================
// SMM SERVICES
// ==========================================

// Get all SMM services
app.get('/api/services', (req, res) => {
  res.json(db.getServices());
});

// ==========================================
// USER ORDERS
// ==========================================

// Place an SMM order
app.post('/api/orders', authenticateUser, (req, res) => {
  try {
    const { serviceId, link, quantity } = req.body;
    const user = req.user;

    if (!serviceId || !link || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Invalid service details, link or quantity.' });
    }

    const service = db.getServiceById(serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    if (quantity < service.min || quantity > service.max) {
      return res.status(400).json({ error: `Quantity must be between ${service.min} and ${service.max}.` });
    }

    // Calculate total price based on service rate (rate is per 1000 items)
    const totalPrice = Math.round(((service.rate * quantity) / 1000) * 100) / 100;

    if (user.balance < totalPrice) {
      return res.status(400).json({ error: `Insufficient balance. This order costs ₹${totalPrice}, but you only have ₹${user.balance}. Please add funds.` });
    }

    // Deduct balance and update user
    const newBalance = Math.round((user.balance - totalPrice) * 100) / 100;
    const newTotalSpent = Math.round((user.totalSpent + totalPrice) * 100) / 100;
    db.updateUser(user.id, { balance: newBalance, totalSpent: newTotalSpent });

    // Create order
    const order = db.createOrder(user.id, service.id, link, quantity, totalPrice);

    res.status(201).json({
      message: 'Order placed successfully!',
      order,
      newBalance
    });
  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ error: 'Server error while placing order.' });
  }
});

// Get user orders
app.get('/api/orders', authenticateUser, (req, res) => {
  const orders = db.getOrdersByUserId(req.user.id);
  // Match service name for better display
  const services = db.getServices();
  const enrichedOrders = orders.map(o => {
    const service = services.find(s => s.id === o.serviceId);
    return {
      ...o,
      serviceName: service ? service.name : 'Unknown Service',
      category: service ? service.category : 'Unknown'
    };
  }).reverse();
  res.json(enrichedOrders);
});

// ==========================================
// USER PAYMENTS (ADD FUNDS)
// ==========================================

// Submit payment request with UTR
app.post('/api/payment/request', authenticateUser, async (req, res) => {
  try {
    const { amount, utr } = req.body;
    const user = req.user;
    const ip = getClientIp(req);
    const location = await getIpLocation(ip);

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Please enter a valid deposit amount.' });
    }

    // Validate 12-digit UTR
    const utrRegex = /^\d{12}$/;
    if (!utr || !utrRegex.test(utr.trim())) {
      return res.status(400).json({ error: 'Please enter a valid 12-digit UPI UTR number.' });
    }

    const cleanUtr = utr.trim();

    // Check if this UTR was already submitted
    const existingTxn = db.getTransactionByUtr(cleanUtr);
    if (existingTxn) {
      return res.status(400).json({ error: 'This UTR number has already been submitted.' });
    }

    const txn = db.createTransaction(user.id, amount, cleanUtr, ip, location);

    res.status(201).json({
      message: 'Payment request submitted! Admin will verify and add balance soon.',
      transaction: txn
    });
  } catch (error) {
    console.error('Payment request error:', error);
    res.status(500).json({ error: 'Server error while submitting payment request.' });
  }
});

// Get user transaction history
app.get('/api/payments', authenticateUser, (req, res) => {
  res.json(db.getTransactionsByUserId(req.user.id).reverse());
});


// ==========================================
// ADMIN API
// ==========================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Admin username and password are required.' });
    }

    if (username !== ADMIN_USERNAME || hashPassword(password) !== ADMIN_PASSWORD_HASH) {
      return res.status(400).json({ error: 'Invalid admin credentials.' });
    }

    const adminToken = 'ADMIN-' + generateToken();
    adminSessions.add(adminToken);

    res.json({
      message: 'Admin login successful!',
      token: adminToken
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error during admin login.' });
  }
});

// Admin Stats
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const users = db.getUsers();
  const orders = db.getOrders();
  const txns = db.getTransactions();

  const totalUsers = users.length;
  const totalBalance = Math.round(users.reduce((sum, u) => sum + (u.balance || 0), 0) * 100) / 100;
  const totalOrders = orders.length;

  // Revenue is calculated based on approved transactions
  const totalRevenue = Math.round(txns.filter(t => t.status === 'Approved').reduce((sum, t) => sum + (t.amount || 0), 0) * 100) / 100;
  const pendingPayments = txns.filter(t => t.status === 'Pending').length;

  res.json({
    totalUsers,
    totalBalance,
    totalOrders,
    totalRevenue,
    pendingPayments
  });
});

// Get all users
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
  const users = db.getUsers().map(u => {
    const { password, sessionToken, ...safeUser } = u;
    return safeUser;
  }).reverse();
  res.json(users);
});

// Adjust User Balance manually
app.post('/api/admin/users/adjust-balance', authenticateAdmin, (req, res) => {
  try {
    const { userId, amount, action } = req.body;
    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid positive amount.' });
    }

    let newBalance = user.balance;
    if (action === 'add') {
      newBalance = Math.round((newBalance + numericAmount) * 100) / 100;
    } else if (action === 'deduct') {
      newBalance = Math.round(Math.max(0, newBalance - numericAmount) * 100) / 100;
    } else {
      return res.status(400).json({ error: 'Invalid action. Must be "add" or "deduct".' });
    }

    db.updateUser(user.id, { balance: newBalance });

    res.json({
      message: `Successfully updated user balance to ₹${newBalance}.`,
      user: { id: user.id, mobile: user.mobile, balance: newBalance }
    });
  } catch (error) {
    console.error('Adjust balance error:', error);
    res.status(500).json({ error: 'Server error while adjusting balance.' });
  }
});

// Get all orders
app.get('/api/admin/orders', authenticateAdmin, (req, res) => {
  const orders = db.getOrders();
  const services = db.getServices();
  const enrichedOrders = orders.map(o => {
    const service = services.find(s => s.id === o.serviceId);
    return {
      ...o,
      serviceName: service ? service.name : 'Unknown Service',
      category: service ? service.category : 'Unknown'
    };
  }).reverse();
  res.json(enrichedOrders);
});

// Update Order Status
app.post('/api/admin/orders/status', authenticateAdmin, (req, res) => {
  const { orderId, status } = req.body;
  if (!['Pending', 'Completed', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid order status. Must be Pending, Completed, or Rejected.' });
  }

  const updatedOrder = db.updateOrderStatus(orderId, status);
  if (!updatedOrder) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  res.json({
    message: `Order status updated to ${status}.`,
    order: updatedOrder
  });
});

// Get all transactions
app.get('/api/admin/payments', authenticateAdmin, (req, res) => {
  const txns = db.getTransactions();
  const users = db.getUsers();
  const enrichedTxns = txns.map(t => {
    const user = users.find(u => u.id === t.userId);
    return {
      ...t,
      mobile: user ? user.mobile : 'Deleted User'
    };
  }).reverse();
  res.json(enrichedTxns);
});

// Approve Payment UTR
app.post('/api/admin/payments/approve', authenticateAdmin, (req, res) => {
  try {
    const { transactionId } = req.body;
    const txns = db.getTransactions();
    const txn = txns.find(t => t.id === transactionId);

    if (!txn) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    if (txn.status !== 'Pending') {
      return res.status(400).json({ error: `This transaction is already ${txn.status}.` });
    }

    const user = db.getUserById(txn.userId);
    if (!user) {
      return res.status(404).json({ error: 'User associated with transaction not found.' });
    }

    // Approve transaction
    db.updateTransactionStatus(txn.id, 'Approved');

    // Add balance to user
    const newBalance = Math.round((user.balance + txn.amount) * 100) / 100;
    db.updateUser(user.id, { balance: newBalance });

    res.json({
      message: `Transaction ${txn.id} approved. ₹${txn.amount} added to user ${user.mobile}.`,
      transaction: { ...txn, status: 'Approved' }
    });
  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({ error: 'Server error while approving payment.' });
  }
});

// Reject Payment UTR
app.post('/api/admin/payments/reject', authenticateAdmin, (req, res) => {
  try {
    const { transactionId } = req.body;
    const txns = db.getTransactions();
    const txn = txns.find(t => t.id === transactionId);

    if (!txn) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    if (txn.status !== 'Pending') {
      return res.status(400).json({ error: `This transaction is already ${txn.status}.` });
    }

    // Reject transaction
    db.updateTransactionStatus(txn.id, 'Rejected');

    res.json({
      message: `Transaction ${txn.id} rejected.`,
      transaction: { ...txn, status: 'Rejected' }
    });
  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ error: 'Server error while rejecting payment.' });
  }
});

// Add Service
app.post('/api/admin/services', authenticateAdmin, (req, res) => {
  try {
    const { category, name, rate, min, max, description } = req.body;
    if (!category || !name || !rate || !min || !max) {
      return res.status(400).json({ error: 'Category, Name, Rate, Min, and Max quantity are required.' });
    }

    const service = db.createService(category, name, rate, min, max, description);
    res.status(201).json({
      message: 'SMM Service created successfully!',
      service
    });
  } catch (error) {
    console.error('Create service error:', error);
    res.status(500).json({ error: 'Server error while creating service.' });
  }
});

// Delete Service
app.delete('/api/admin/services/:id', authenticateAdmin, (req, res) => {
  try {
    const deleted = db.deleteService(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Service not found.' });
    }
    res.json({
      message: 'Service deleted successfully!',
      service: deleted
    });
  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({ error: 'Server error while deleting service.' });
  }
});

// ==========================================
// INITIALIZATION
// ==========================================

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` SMM Panel Server Running Successfully!`);
  console.log(` Port: ${PORT}`);
  console.log(` User Panel: http://localhost:${PORT}`);
  console.log(` Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`==================================================`);
});
