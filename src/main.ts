import "./instrument";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
    FastifyAdapter,
    NestFastifyApplication
} from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";

import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "#/common/filters/global-filter.filter";
import { ConfigService } from "@nestjs/config";
import { RedisIoAdapter } from "#/common/websockets/redis-io.adapter";
import { Logger } from "nestjs-pino";

async function bootstrap() {
    const isProduction = process.env.NODE_ENV === "production";

    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,

        new FastifyAdapter({
            logger: false,
            bodyLimit: 1048576, // 1 MB max JSON body
            maxParamLength: 100,
            trustProxy: isProduction
        })
    );

    const configService = app.get(ConfigService);
    const port = configService.get<number>("PORT", 3000);

    // Uses nestjs pino logger for logs
    app.useLogger(app.get(Logger));

    // ---------------- Helmet ----------------
    const helmetOptions: any = {
        // Basic protections always on
        frameguard: { action: "deny" },
        dnsPrefetchControl: { allow: false },
        referrerPolicy: { policy: "strict-origin-when-cross-origin" }
    };

    if (isProduction) {
        // Strict CSP – only in production where we know the exact domains
        helmetOptions.contentSecurityPolicy = {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://js.paystack.co"
                ],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https://ui-avatars.com"],
                connectSrc: [
                    "'self'",
                    "wss://your-supabase-url.supabase.co" // replace with your actual Supabase URL
                ],
                frameSrc: ["'self'", "https://checkout.paystack.com"]
            }
        };
        // HSTS – only in production (disaster on localhost)
        helmetOptions.hsts = {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        };
    } else {
        // Dev‑friendly CSP – still reasonably tight, but allows localhost
        helmetOptions.contentSecurityPolicy = {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://js.paystack.co"
                ],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: [
                    "'self'",
                    "ws://localhost:*",
                    "http://localhost:*"
                ],
                frameSrc: ["'self'"]
            }
        };
    }

    await app.register(helmet, helmetOptions);

    // ---------------- Compression ----------------
    await app.register(compress);

    // ---------------- Cookie ----------------
    const cookieSecret = configService.get<string>(
        "COOKIE_SECRET",
        "dev-secret-change-me"
    );
    await app.register(cookie, { secret: cookieSecret });

    // ---------------- Multipart ----------------
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

    // ---------------- Global prefix ----------------
    app.setGlobalPrefix("api");

    // ---------------- CORS ----------------
    if (isProduction) {
        const clientUrl = configService.get<string>("CLIENT_URL");
        const allowedOrigins = clientUrl
            ? clientUrl.split(",").map(url => url.trim())
            : false;

        app.enableCors({
            origin: allowedOrigins || false, // fail closed
            credentials: true,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
        });
    } else {
        // Development: allow the React dev server (default is localhost:5173)
        app.enableCors({
            origin: ["http://localhost:5173", "http://localhost:3000"],
            credentials: true,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
        });
    }

    // ---------------- Global pipes & filters ----------------
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
            transformOptions: { enableImplicitConversion: true }
        })
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    // ---------------- WebSocket adapter ----------------
    const redisIoAdapter = new RedisIoAdapter(app, configService);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    // ---------------- Start server ----------------
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 Server running on http://localhost:${port}/api`);
}

bootstrap();
