module.exports = {
  apps: [{
    name: 'uynest-api',
    script: 'dist/main.js',
    exec_mode: 'fork',
    instances: 1,
    max_memory_restart: '450M',
    env: { NODE_ENV: 'production' },
  }],
};
