const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const client = require('prom-client');
const config = require('./config');

function applySecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "*"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
  }));

  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  const apiLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
  });
  app.use('/api/', apiLimiter);

  const csrfProtection = csrf({ cookie: true });
  app.use((req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    csrfProtection(req, res, next);
  });

  const collectDefaultMetrics = client.collectDefaultMetrics;
  collectDefaultMetrics({ timeout: 5000 });
}

module.exports = { applySecurity };
