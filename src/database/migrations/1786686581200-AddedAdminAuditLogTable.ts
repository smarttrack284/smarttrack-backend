import { MigrationInterface, QueryRunner } from "typeorm";

export class AddedAdminAuditLogTable1786686581200 implements MigrationInterface {
    name = 'AddedAdminAuditLogTable1786686581200'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "admin_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "admin_user_id" uuid, "company_id" uuid, "action" character varying(255) NOT NULL, "metadata" jsonb, "severity" character varying(50) NOT NULL DEFAULT 'info', "message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_de7a8fc2fbb525484c71a86bb96" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "user_roles" ADD "avatar_url" character varying(255)`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3df3a38b9c8feec3c1bd45dbc"`);
        await queryRunner.query(`ALTER TYPE "public"."activity_logs_category_enum" ADD VALUE 'admin_action'`);
        await queryRunner.query(`ALTER TYPE "public"."user_roles_role_enum" ADD VALUE 'super_admin'`);
        await queryRunner.query(`CREATE INDEX "IDX_d3df3a38b9c8feec3c1bd45dbc" ON "activity_logs"  ("company_id", "category") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_d3df3a38b9c8feec3c1bd45dbc"`);
        await queryRunner.query(`CREATE TYPE "public"."user_roles_role_enum_old" AS ENUM('owner', 'admin', 'driver', 'dispatcher')`);
        await queryRunner.query(`ALTER TABLE "user_roles" ALTER COLUMN "role" TYPE "public"."user_roles_role_enum_old" USING "role"::"text"::"public"."user_roles_role_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."user_roles_role_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."user_roles_role_enum_old" RENAME TO "user_roles_role_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."activity_logs_category_enum_old" AS ENUM('order', 'driver', 'team', 'api_key', 'system')`);
        await queryRunner.query(`ALTER TABLE "activity_logs" ALTER COLUMN "category" TYPE "public"."activity_logs_category_enum_old" USING "category"::"text"::"public"."activity_logs_category_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."activity_logs_category_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."activity_logs_category_enum_old" RENAME TO "activity_logs_category_enum"`);
        await queryRunner.query(`CREATE INDEX "IDX_d3df3a38b9c8feec3c1bd45dbc" ON "activity_logs" USING btree ("category", "company_id") `);
        await queryRunner.query(`ALTER TABLE "user_roles" DROP COLUMN "avatar_url"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN "cancelAtPeriodEnd"`);
        await queryRunner.query(`DROP TABLE "admin_audit_logs"`);
    }

}
