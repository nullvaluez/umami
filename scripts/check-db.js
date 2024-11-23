/* eslint-disable no-console */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const chalk = require('chalk');
const { execSync } = require('child_process');
const semver = require('semver');

// List of database environment variables to check
const DATABASE_URLS = ['DATABASE_URL', 'DIRECT_DATABASE_URL'];

if (process.env.SKIP_DB_CHECK) {
  console.log('Skipping database check.');
  process.exit(0);
}

// Function to retrieve database type from a given URL
function getDatabaseType(url) {
  const type = url && url.split(':')[0];

  if (type === 'postgres') {
    return 'postgresql';
  }

  return type;
}

// Success and error message helpers
function success(msg) {
  console.log(chalk.greenBright(`✓ ${msg}`));
}

function error(msg) {
  console.log(chalk.redBright(`✗ ${msg}`));
}

// Function to check if the required environment variables are defined
async function checkEnv() {
  let allDefined = true;
  DATABASE_URLS.forEach((envVar) => {
    if (!process.env[envVar]) {
      error(`${envVar} is not defined.`);
      allDefined = false;
    } else {
      success(`${envVar} is defined.`);
    }
  });

  if (!allDefined) {
    throw new Error('One or more required database environment variables are missing.');
  }
}

// Function to perform checks for a single database URL
async function performChecks(dbUrl, label) {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

  try {
    // Check database connection
    await prisma.$connect();
    success(`[${label}] Database connection successful.`);

    // Check database version
    const queryResult = await prisma.$queryRaw`SELECT version()`;
    const versionString = queryResult[0].version;
    const version = semver.valid(semver.coerce(versionString));

    const databaseType = getDatabaseType(dbUrl);
    const minVersion = databaseType === 'postgresql' ? '9.4.0' : '5.7.0';

    if (!version) {
      throw new Error(`[${label}] Unable to parse database version.`);
    }

    if (semver.lt(version, minVersion)) {
      throw new Error(
        `[${label}] Database version is not compatible. Please upgrade ${databaseType} to version ${minVersion} or greater.`,
      );
    }

    success(`[${label}] Database version (${version}) is compatible.`);

    // Check for v1 migrations
    const migrations = await prisma.$queryRaw`SELECT * FROM _prisma_migrations WHERE started_at < '2023-04-17'`;
    if (migrations.length > 0) {
      error(
        `[${label}] Umami v1 tables detected. To upgrade from v1 to v2, visit https://umami.is/docs/migrate-v1-v2.`,
      );
      throw new Error(`[${label}] Umami v1 tables detected.`);
    } else {
      success(`[${label}] No Umami v1 tables detected.`);
    }

    // Apply migrations
    console.log(execSync('npx prisma migrate deploy').toString());
    success(`[${label}] Database is up to date.`);
  } catch (e) {
    throw new Error(`[${label}] ${e.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  try {
    await checkEnv();

    // Iterate over each database URL and perform checks
    for (const envVar of DATABASE_URLS) {
      const dbUrl = process.env[envVar];
      const label = envVar; // Label to identify which URL is being checked

      await performChecks(dbUrl, label);
    }

    console.log(chalk.blueBright('All database checks passed successfully.'));
    process.exit(0);
  } catch (e) {
    error(e.message);
    process.exit(1);
  }
})();
