import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiKey } from "#/common/entities/api-key.entity";
import { UsersModule } from "#/modules/users/users.module";
import { SubscriptionsModule } from "#/modules/subscriptions/subscriptions.module";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeysController } from "./api-keys.controller";

@Module({
    imports: [
        TypeOrmModule.forFeature([ApiKey]),
        UsersModule,
        SubscriptionsModule
    ],
    controllers: [ApiKeysController],
    providers: [ApiKeysService]
})
export class ApiKeysModule {}
