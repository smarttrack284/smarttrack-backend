import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: 'https://35bc03479d94ab4d9d2c0eec43b1adba@o4511877363073024.ingest.us.sentry.io/4511877410717696',
  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});
