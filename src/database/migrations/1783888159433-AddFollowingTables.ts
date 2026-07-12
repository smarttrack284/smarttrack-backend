import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowingTables1783888159433 implements MigrationInterface {
    name = 'AddFollowingTables1783888159433'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."notification_settings_digest_frequency_enum" AS ENUM('off', 'daily', 'weekly')`);
        await queryRunner.query(`CREATE TABLE "notification_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "email_order_created" boolean NOT NULL DEFAULT true, "email_order_assigned" boolean NOT NULL DEFAULT true, "email_order_picked_up" boolean NOT NULL DEFAULT true, "email_order_delivered" boolean NOT NULL DEFAULT true, "email_order_failed" boolean NOT NULL DEFAULT true, "email_order_cancelled" boolean NOT NULL DEFAULT true, "email_driver_offline" boolean NOT NULL DEFAULT false, "email_team_invite_accepted" boolean NOT NULL DEFAULT false, "digest_frequency" "public"."notification_settings_digest_frequency_enum" NOT NULL DEFAULT 'off', "sms_urgent_only" boolean NOT NULL DEFAULT false, "quiet_hours_enabled" boolean NOT NULL DEFAULT false, "quiet_hours_start" character varying, "quiet_hours_end" character varying, CONSTRAINT "UQ_dc4cd549acf1e13b9e49a32fc58" UNIQUE ("company_id"), CONSTRAINT "REL_dc4cd549acf1e13b9e49a32fc5" UNIQUE ("company_id"), CONSTRAINT "PK_d131abd7996c475ef768d4559ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dc4cd549acf1e13b9e49a32fc5" ON "notification_settings"  ("company_id") `);
        await queryRunner.query(`CREATE TYPE "public"."saved_locations_kind_enum" AS ENUM('shop', 'warehouse', 'other')`);
        await queryRunner.query(`CREATE TABLE "saved_locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "label" character varying(255) NOT NULL, "address" character varying(500) NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "kind" "public"."saved_locations_kind_enum" NOT NULL DEFAULT 'other', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bc4bde22511c9a2963727c194cd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fd1986367589d3f06aa9e4dce9" ON "saved_locations"  ("company_id") `);
        await queryRunner.query(`CREATE TABLE "companies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "timezone" character varying(100) NOT NULL, "logo_url" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d0af6f5866201d5cb424767744a" UNIQUE ("email"), CONSTRAINT "PK_d4bc3e82a314fa9e29f652c2c22" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "api_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "company_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "key_hash" character varying(255) NOT NULL, "key_preview" character varying(32) NOT NULL, "last_used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_57384430aa1959f4578046c9b81" UNIQUE ("key_hash"), CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8396859f08e7ad26726c9b3860" ON "api_keys"  ("company_id") `);
        await queryRunner.query(`CREATE TYPE "public"."user_roles_role_enum" AS ENUM('owner', 'admin', 'driver', 'dispatcher')`);
        await queryRunner.query(`CREATE TABLE "user_roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "company_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "role" "public"."user_roles_role_enum" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8acd5cf26ebd158416f477de799" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_df162a656b0dd26d4f1b76089c" ON "user_roles"  ("company_id") `);
        await queryRunner.query(`ALTER TABLE "notification_settings" ADD CONSTRAINT "FK_dc4cd549acf1e13b9e49a32fc58" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "saved_locations" ADD CONSTRAINT "FK_fd1986367589d3f06aa9e4dce9f" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD CONSTRAINT "FK_8396859f08e7ad26726c9b3860e" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_df162a656b0dd26d4f1b76089ce" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_df162a656b0dd26d4f1b76089ce"`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP CONSTRAINT "FK_8396859f08e7ad26726c9b3860e"`);
        await queryRunner.query(`ALTER TABLE "saved_locations" DROP CONSTRAINT "FK_fd1986367589d3f06aa9e4dce9f"`);
        await queryRunner.query(`ALTER TABLE "notification_settings" DROP CONSTRAINT "FK_dc4cd549acf1e13b9e49a32fc58"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_df162a656b0dd26d4f1b76089c"`);
        await queryRunner.query(`DROP TABLE "user_roles"`);
        await queryRunner.query(`DROP TYPE "public"."user_roles_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8396859f08e7ad26726c9b3860"`);
        await queryRunner.query(`DROP TABLE "api_keys"`);
        await queryRunner.query(`DROP TABLE "companies"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd1986367589d3f06aa9e4dce9"`);
        await queryRunner.query(`DROP TABLE "saved_locations"`);
        await queryRunner.query(`DROP TYPE "public"."saved_locations_kind_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc4cd549acf1e13b9e49a32fc5"`);
        await queryRunner.query(`DROP TABLE "notification_settings"`);
        await queryRunner.query(`DROP TYPE "public"."notification_settings_digest_frequency_enum"`);
    }

}
