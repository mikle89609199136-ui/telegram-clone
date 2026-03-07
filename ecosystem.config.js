module.exports = {
  apps: [
    {
      name: 'craheapp-api',
      script: 'server.js',
      env: { SERVICE: 'api', NODE_ENV: 'production' },
      instances: 'max',
      exec_mode: 'cluster',
    },
    {
      name: 'craheapp-ws',
      script: 'server.js',
      env: { SERVICE: 'ws', NODE_ENV: 'production' },
      instances: 2,
    },
    {
      name: 'craheapp-media',
      script: 'server.js',
      env: { SERVICE: 'media', NODE_ENV: 'production' },
      instances: 1,
    },
    {
      name: 'craheapp-ai',
      script: 'server.js',
      env: { SERVICE: 'ai', NODE_ENV: 'production' },
      instances: 1,
    },
  ],
};
