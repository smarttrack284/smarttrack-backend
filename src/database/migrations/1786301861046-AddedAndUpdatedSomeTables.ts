import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedAndUpdatedSomeTables1786301861046 implements MigrationInterface {
    name = 'AddedAndUpdatedSomeTables1786301861046'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "saved_locations" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "deleted_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "companies" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD "last_expiry_reminder_sent_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "trips" ADD "trip_reference" character varying(100) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "trips" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "trip_stops" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "usages" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "webhook_endpoints" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "webhook_deliveries" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE INDEX "IDX_04fa926c32b43d66134e059d76" ON "webhook_deliveries"  ("created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_04fa926c32b43d66134e059d76"`);
        await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "webhook_endpoints" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "usages" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "trip_stops" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "trip_reference"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "last_expiry_reminder_sent_at"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "saved_locations" DROP COLUMN "deleted_at"`);
    }

}
