import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedCompanyNotificationSettingsTable1785062084007 implements MigrationInterface {
    name = 'AddedCompanyNotificationSettingsTable1785062084007'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "companies_notification_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "customer_email_enabled" boolean NOT NULL DEFAULT true, "customer_sms_enabled" boolean NOT NULL DEFAULT false, "customer_email_order_created" boolean NOT NULL DEFAULT true, "customer_email_order_assigned" boolean NOT NULL DEFAULT true, "customer_email_order_picked_up" boolean NOT NULL DEFAULT true, "customer_email_order_in_transit" boolean NOT NULL DEFAULT true, "customer_email_order_delivered" boolean NOT NULL DEFAULT true, "customer_email_order_failed" boolean NOT NULL DEFAULT true, "customer_email_order_cancelled" boolean NOT NULL DEFAULT true, "customer_sms_order_created" boolean NOT NULL DEFAULT false, "customer_sms_order_assigned" boolean NOT NULL DEFAULT false, "customer_sms_order_picked_up" boolean NOT NULL DEFAULT false, "customer_sms_order_in_transit" boolean NOT NULL DEFAULT false, "customer_sms_order_delivered" boolean NOT NULL DEFAULT false, "customer_sms_order_failed" boolean NOT NULL DEFAULT false, "customer_sms_order_cancelled" boolean NOT NULL DEFAULT false, "email_team_member_invited" boolean NOT NULL DEFAULT true, "email_team_member_joined" boolean NOT NULL DEFAULT true, "email_failed_orders" boolean NOT NULL DEFAULT true, "email_unassigned_orders" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_282744930b966ddb11af240f9b0" UNIQUE ("company_id"), CONSTRAINT "REL_282744930b966ddb11af240f9b" UNIQUE ("company_id"), CONSTRAINT "PK_e1c31c4a1853aeaa7acf176a536" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_282744930b966ddb11af240f9b" ON "companies_notification_settings"  ("company_id") `);
        await queryRunner.query(`CREATE TABLE "users_notification_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "email_order_created" boolean NOT NULL DEFAULT true, "email_order_assigned" boolean NOT NULL DEFAULT true, "email_order_picked_up" boolean NOT NULL DEFAULT true, "email_order_in_transit" boolean NOT NULL DEFAULT true, "email_order_delivered" boolean NOT NULL DEFAULT true, "email_order_failed" boolean NOT NULL DEFAULT true, "email_order_cancelled" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_bdc76a345f0b2b6fb4483d9ae88" UNIQUE ("user_id"), CONSTRAINT "REL_bdc76a345f0b2b6fb4483d9ae8" UNIQUE ("user_id"), CONSTRAINT "PK_dfd15678f9229b41f4d3c2b85fb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bdc76a345f0b2b6fb4483d9ae8" ON "users_notification_settings"  ("user_id") `);
        await queryRunner.query(`ALTER TABLE "companies" ADD "logo_filename" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "customer_email" character varying(100)`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_status_enum" RENAME TO "subscriptions_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active')`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "public"."subscriptions_status_enum" USING "status"::"text"::"public"."subscriptions_status_enum"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD CONSTRAINT "FK_282744930b966ddb11af240f9b0" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users_notification_settings" ADD CONSTRAINT "FK_bdc76a345f0b2b6fb4483d9ae88" FOREIGN KEY ("user_id") REFERENCES "user_roles"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users_notification_settings" DROP CONSTRAINT "FK_bdc76a345f0b2b6fb4483d9ae88"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP CONSTRAINT "FK_282744930b966ddb11af240f9b0"`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum_old" AS ENUM('active', 'canceled', 'past_due')`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "public"."subscriptions_status_enum_old" USING "status"::"text"::"public"."subscriptions_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_status_enum_old" RENAME TO "subscriptions_status_enum"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "customer_email"`);
        await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "logo_filename"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bdc76a345f0b2b6fb4483d9ae8"`);
        await queryRunner.query(`DROP TABLE "users_notification_settings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_282744930b966ddb11af240f9b"`);
        await queryRunner.query(`DROP TABLE "companies_notification_settings"`);
    }

}
