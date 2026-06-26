require('dotenv').config();

const { testPostgresConnection, getPostgresConfigFromEnv } = require('./client');

(async () => {
  try {
    const config = getPostgresConfigFromEnv();
    const row = await testPostgresConnection();
    console.log('PostgreSQL connection test passed.');
    console.log(`Host: ${config.host}`);
    console.log(`Port: ${config.port}`);
    console.log(`Database: ${row?.database_name || config.database}`);
    console.log(`User: ${row?.user_name || config.user}`);
    console.log(`Server Time: ${row?.server_time || 'unknown'}`);
    process.exit(0);
  } catch (error) {
    console.error('PostgreSQL connection test failed.');
    console.error(error?.message || error);
    process.exit(1);
  }
})();
