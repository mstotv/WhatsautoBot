require('dotenv').config();
const TelegramBot = require('./bot/telegram');
const APIServer = require('./api/server');
const SocketService = require('./services/socketService');
const BroadcastQueue = require('./services/broadcastQueue');
const { migrate } = require('./database/migrate');

async function startApplication() {
  try {
    console.log('🚀 Starting WhatsApp Automation Bot...\n');

    // 1. Run database migrations
    console.log('📊 Running database migrations...');
    await migrate();
    console.log('✅ Database ready\n');

    // 2. Initialize broadcast queue
    console.log('📢 Initializing broadcast queue...');
    const broadcastQueue = new BroadcastQueue();
    console.log('✅ Broadcast queue ready\n');

    // 3. Start Telegram bot
    console.log('🤖 Starting Telegram bot...');
    const telegramBot = new TelegramBot();
    telegramBot.launch();
    console.log('✅ Telegram bot running\n');

    // 4. Start API server
    console.log('🌐 Starting API server...');
    const apiServer = new APIServer(telegramBot);
    const port = process.env.PORT || 3000;
    apiServer.start(port);
    console.log(`✅ API server running on port ${port}\n`);

    // 5. Initialize Socket Service
    console.log('🔌 Initializing WebSocket connections...');
    const socketService = new SocketService(apiServer, telegramBot);
    await socketService.init();
    console.log('✅ WebSockets ready\n');

    // Store socketService in telegramBot instance to allow dynamic connections
    await telegramBot.setSocketService(socketService);
    console.log('✅ WebSockets linked to TelegramBot\n');

    console.log('════════════════════════════════════════');
    console.log('✅ All systems operational!');
    console.log('════════════════════════════════════════');
    console.log(`📱 Telegram Bot: @${(await telegramBot.getBot().telegram.getMe()).username}`);
    console.log(`🌐 API Server: http://localhost:${port}`);
    console.log(`📢 Channel: ${process.env.TELEGRAM_CHANNEL_USERNAME}`);
    console.log(`🔗 Evolution API: ${process.env.EVOLUTION_API_URL}`);
    console.log('════════════════════════════════════════\n');

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);

      telegramBot.stop();
      console.log('✅ Telegram bot stopped');

      await broadcastQueue.queue.close();
      console.log('✅ Broadcast queue closed');

      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
startApplication();
