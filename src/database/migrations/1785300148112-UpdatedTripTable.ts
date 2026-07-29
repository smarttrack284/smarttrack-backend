import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdatedTripTable1785300148112 implements MigrationInterface {
    name = 'UpdatedTripTable1785300148112'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "trips" ADD "driver_speed_kph" double precision`);
        await queryRunner.query(`ALTER TABLE "trips" ADD "driver_heading" double precision`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_payment_provider_enum" RENAME TO "subscriptions_payment_provider_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_payment_provider_enum" AS ENUM('paystack')`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "payment_provider" TYPE "public"."subscriptions_payment_provider_enum" USING "payment_provider"::"text"::"public"."subscriptions_payment_provider_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_payment_provider_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_payment_provider_enum_old" AS ENUM('stripe', 'paystack')`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "payment_provider" TYPE "public"."subscriptions_payment_provider_enum_old" USING "payment_provider"::"text"::"public"."subscriptions_payment_provider_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_payment_provider_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_payment_provider_enum_old" RENAME TO "subscriptions_payment_provider_enum"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "driver_heading"`);
        await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "driver_speed_kph"`);
    }

}
