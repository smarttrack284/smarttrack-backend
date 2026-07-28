import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedTheFollowingTables1785218122542 implements MigrationInterface {
    name = 'AddedTheFollowingTables1785218122542'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."activity_logs_category_enum" AS ENUM('order', 'driver', 'team', 'api_key', 'system')`);
        await queryRunner.query(`CREATE TYPE "public"."activity_logs_severity_enum" AS ENUM('info', 'warning', 'critical')`);
        await queryRunner.query(`CREATE TABLE "activity_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "category" "public"."activity_logs_category_enum" NOT NULL, "event_type" character varying(64) NOT NULL, "severity" "public"."activity_logs_severity_enum" NOT NULL DEFAULT 'info', "message" text NOT NULL, "metadata" jsonb, "actor_user_id" uuid, "actor_name" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f25287b6140c5ba18d38776a796" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d3df3a38b9c8feec3c1bd45dbc" ON "activity_logs"  ("company_id", "category") `);
        await queryRunner.query(`CREATE INDEX "IDX_fd6cf5e5e0f2a4fced4c75a9e3" ON "activity_logs"  ("company_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."webhook_endpoints_events_enum" AS ENUM('order.created', 'order.status_changed', 'order.delivered', 'order.failed', 'stop.arrived', 'stop.completed', 'stop.skipped', 'team.member_accepted')`);
        await queryRunner.query(`CREATE TABLE "webhook_endpoints" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "description" character varying(100) NOT NULL, "url" character varying(500) NOT NULL, "secret_encrypted" character varying(500) NOT NULL, "events" "public"."webhook_endpoints_events_enum" array NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_054c4cfb95223732f5939d2d546" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_66f1850cec1e3e62a1988f78e6" ON "webhook_endpoints"  ("company_id") `);
        await queryRunner.query(`CREATE TYPE "public"."webhook_deliveries_event_type_enum" AS ENUM('order.created', 'order.status_changed', 'order.delivered', 'order.failed', 'stop.arrived', 'stop.completed', 'stop.skipped', 'team.member_accepted')`);
        await queryRunner.query(`CREATE TYPE "public"."webhook_deliveries_status_enum" AS ENUM('pending', 'success', 'failed')`);
        await queryRunner.query(`CREATE TABLE "webhook_deliveries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "webhook_endpoint_id" uuid NOT NULL, "event_id" uuid NOT NULL, "event_type" "public"."webhook_deliveries_event_type_enum" NOT NULL, "payload" jsonb NOT NULL, "status" "public"."webhook_deliveries_status_enum" NOT NULL DEFAULT 'pending', "attempt_number" integer NOT NULL DEFAULT '1', "http_status_code" integer, "response_body" character varying(1000), "error_message" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "delivered_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_535dd409947fb6d8fc6dfc0112a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_27d1ee90033bdafe0ffe8f1be6" ON "webhook_deliveries"  ("event_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_310fcce885ee3a37468c56b386" ON "webhook_deliveries"  ("webhook_endpoint_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_created"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_assigned"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_picked_up"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_in_transit"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_delivered"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_failed"`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" DROP COLUMN "customer_sms_order_cancelled"`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "customer_email" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "created_by_user_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_status_enum" ADD VALUE 'canceled'`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_status_enum" ADD VALUE 'past_due'`);
        await queryRunner.query(`ALTER TABLE "activity_logs" ADD CONSTRAINT "FK_c48f8cc1a3f974c0712af10ecbc" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "FK_66f1850cec1e3e62a1988f78e6d" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "FK_ebc7f6ebad5d665588d12549c68" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "FK_ebc7f6ebad5d665588d12549c68"`);
        await queryRunner.query(`ALTER TABLE "webhook_endpoints" DROP CONSTRAINT "FK_66f1850cec1e3e62a1988f78e6d"`);
        await queryRunner.query(`ALTER TABLE "activity_logs" DROP CONSTRAINT "FK_c48f8cc1a3f974c0712af10ecbc"`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum_old" AS ENUM('active')`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "public"."subscriptions_status_enum_old" USING "status"::"text"::"public"."subscriptions_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."subscriptions_status_enum_old" RENAME TO "subscriptions_status_enum"`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "created_by_user_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "customer_email" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_cancelled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_failed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_delivered" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_in_transit" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_picked_up" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_assigned" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "companies_notification_settings" ADD "customer_sms_order_created" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`DROP INDEX "public"."IDX_310fcce885ee3a37468c56b386"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_27d1ee90033bdafe0ffe8f1be6"`);
        await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
        await queryRunner.query(`DROP TYPE "public"."webhook_deliveries_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."webhook_deliveries_event_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_66f1850cec1e3e62a1988f78e6"`);
        await queryRunner.query(`DROP TABLE "webhook_endpoints"`);
        await queryRunner.query(`DROP TYPE "public"."webhook_endpoints_events_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd6cf5e5e0f2a4fced4c75a9e3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3df3a38b9c8feec3c1bd45dbc"`);
        await queryRunner.query(`DROP TABLE "activity_logs"`);
        await queryRunner.query(`DROP TYPE "public"."activity_logs_severity_enum"`);
        await queryRunner.query(`DROP TYPE "public"."activity_logs_category_enum"`);
    }

}
