import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExpiresAtToApiKeys1785678886560 implements MigrationInterface {
    name = 'AddExpiresAtToApiKeys1785678886560'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "expires_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "key_preview"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "key_preview" character varying(50) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "last_used_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "last_used_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "revoked_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "revoked_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "revoked_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "revoked_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "last_used_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "last_used_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "key_preview"`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "key_preview" character varying(32) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "expires_at"`);
    }

}
