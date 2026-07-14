import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateAndAddFollowingTables1783977402511 implements MigrationInterface {
    name = 'UpdateAndAddFollowingTables1783977402511'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_fkey"`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_plan_enum" AS ENUM('free', 'starter', 'pro')`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active', 'canceled', 'past_due')`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_payment_provider_enum" AS ENUM('stripe', 'paystack')`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "plan" "public"."subscriptions_plan_enum" NOT NULL DEFAULT 'free', "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'active', "current_period_end" TIMESTAMP WITH TIME ZONE, "payment_provider" "public"."subscriptions_payment_provider_enum", "payment_customer_id" character varying(255), "payment_subscription_id" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_7e3cc01c420db5151aa21360358" UNIQUE ("company_id"), CONSTRAINT "UQ_968f94f0752ef669fc0c4420635" UNIQUE ("payment_subscription_id"), CONSTRAINT "REL_7e3cc01c420db5151aa2136035" UNIQUE ("company_id"), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c49c2d6460892d344e29112948" ON "subscriptions"  ("payment_customer_id") `);
        await queryRunner.query(`CREATE TABLE "usages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "orders_this_period" integer NOT NULL DEFAULT '0', "team_members_count" integer NOT NULL DEFAULT '0', "period_start" TIMESTAMP WITH TIME ZONE NOT NULL, "period_end" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_80b2d092b0f58bcdbb369e885dd" UNIQUE ("company_id"), CONSTRAINT "REL_80b2d092b0f58bcdbb369e885d" UNIQUE ("company_id"), CONSTRAINT "PK_75c9a59a186b326ad102170e0a7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_87b8888186ca9769c960e92687" ON "user_roles"  ("user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_63f038e4b86436ae6729e65a3c" ON "user_roles"  ("user_id", "company_id") `);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_7e3cc01c420db5151aa21360358" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "usages" ADD CONSTRAINT "FK_80b2d092b0f58bcdbb369e885dd" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usages" DROP CONSTRAINT "FK_80b2d092b0f58bcdbb369e885dd"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_7e3cc01c420db5151aa21360358"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_63f038e4b86436ae6729e65a3c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_87b8888186ca9769c960e92687"`);
        await queryRunner.query(`DROP TABLE "usages"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c49c2d6460892d344e29112948"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_payment_provider_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_plan_enum"`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
