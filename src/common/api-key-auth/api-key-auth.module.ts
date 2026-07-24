import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '#/common/entities/api-key.entity';
import { ApiKeyGuard } from '#/common/guards/api-key.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class ApiKeyAuthModule {}